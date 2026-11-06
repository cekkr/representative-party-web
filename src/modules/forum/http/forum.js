import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { classifyTopic } from '../../topics/classification.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { evaluateAction, getCirclePolicyState } from '../../circle/policy.js';
import { logTransaction } from '../../transactions/registry.js';
import { persistDiscussions } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, findVisibleEntry, stampLocalEntry } from '../../federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { renderForum, renderForumThread } from '../../../interfaces/http/views/forumView.js';
import { parsePage } from '../../../shared/utils/pagination.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { recordRateLimit } from '../../ops/metrics.js';
import { getTopicConfig } from '../../topics/topicGardenerClient.js';
import { getTopicPreferences } from '../../topics/preferences.js';
import { buildTopicOptions, renderTopicDatalist } from '../../../interfaces/http/views/topicHelpers.js';
import { forumThreadHref, isForumThread } from '../threads.js';

export async function postThread({ req, res, state }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'forum_thread', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'forum_thread');
    return sendRateLimit(res, {
      action: 'forum_thread',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }
  const body = await readRequestBody(req);
  const title = sanitizeText(body.title || '', 160);
  const content = sanitizeText(body.content || '', 1200);
  if (!title || !content) {
    return sendJson(res, 400, { error: 'missing_fields' });
  }
  const policy = getCirclePolicyState(state);
  const classifiedTopic = sanitizeText(body.topic || '', 80) || await classifyTopic(`${title} ${content}`, state);
  const topicResult = await ensureTopicPath(state, classifiedTopic, { source: 'forum' });
  const topic = topicResult.topic?.label || classifiedTopic || 'general';
  const topicPath = topicResult.path?.length ? topicResult.path.map((entry) => entry.label) : [];
  const entry = {
    id: randomUUID(),
    topic,
    topicId: topicResult.topic?.id || null,
    topicPath,
    stance: 'article',
    title,
    content,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId: null,
    policyId: policy.id,
    policyVersion: policy.version,
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  await logTransaction(state, {
    type: 'forum_thread',
    actorHash: person?.pidHash || 'anonymous',
    payload: { threadId: entry.id, topic },
  });
  return sendRedirect(res, forumThreadHref(entry.id));
}

export async function postComment({ req, res, state, url }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'forum_comment', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'forum_comment');
    return sendRateLimit(res, {
      action: 'forum_comment',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }
  const body = await readRequestBody(req);
  const parentId = sanitizeText(body.parentId || '', 120);
  const content = sanitizeText(body.content || '', 800);
  const evidenceLinks = parseEvidenceLinks(body.evidenceLinks || '');
  if (!parentId || !content) {
    return sendJson(res, 400, { error: 'missing_fields' });
  }
  const parent = findForumThread(state, parentId);
  if (!parent) {
    return sendJson(res, 404, { error: 'thread_not_found' });
  }
  const policy = getCirclePolicyState(state);
  let topicId = parent.topicId || null;
  let topicPath = Array.isArray(parent.topicPath) ? parent.topicPath : [];
  if (!topicId) {
    const fallback = await ensureTopicPath(state, parent.topic || 'general', { source: 'forum' });
    topicId = fallback.topic?.id || null;
    topicPath = fallback.path?.length ? fallback.path.map((entry) => entry.label) : topicPath;
  }
  const entry = {
    id: randomUUID(),
    topic: parent.topic,
    topicId,
    topicPath,
    stance: 'comment',
    title: '',
    content,
    evidenceLinks,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId,
    policyId: policy.id,
    policyVersion: policy.version,
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  await logTransaction(state, {
    type: 'forum_comment',
    actorHash: person?.pidHash || 'anonymous',
    payload: { threadId: parentId, evidenceCount: evidenceLinks.length },
  });
  return sendRedirect(res, forumThreadHref(parent.id, readCollectionQuery(url.searchParams)));
}

export async function renderForumRoute({ req, res, state, wantsPartial, url }) {
  const person = getPerson(req, state);
  const query = readCollectionQuery(url.searchParams);
  const threadId = sanitizeText(url.searchParams.get('thread') || url.searchParams.get('reply') || '', 120);
  const postGate = evaluateAction(state, person, 'post');
  const thread = threadId ? findForumThread(state, threadId) : null;
  if (thread) {
    const comments = filterVisibleEntries(state.discussions, state, (entry) =>
      !entry.groupId && !entry.petitionId && entry.parentId === thread.id,
    );
    const html = await renderPage('forum-thread', {
      ...renderForumThread(thread, comments, state, { ...query, postGate }),
      person,
      pageKey: 'forum',
    }, { wantsPartial, title: 'Forum', state });
    return sendHtml(res, html);
  }

  const entries = filterVisibleEntries(state.discussions, state, (entry) =>
    !entry.groupId && !entry.petitionId && (entry.parentId || isForumThread(entry)),
  );
  const topicConfig = getTopicConfig(state);
  const html = await renderPage('forum', {
    ...renderForum(entries, state, { ...query, postGate }),
    person,
    forumNotice: threadId ? 'That article could not be found.' : '',
    workspaceCreateHref: postGate.allowed ? '/forum?compose=thread#forum-compose' : '',
    composeOpen: url.searchParams.has('compose') ? 'open' : '',
    topicDatalist: renderTopicDatalist(buildTopicOptions({
      anchors: topicConfig.anchors,
      pinned: topicConfig.pinned,
      preferences: getTopicPreferences(state, person),
      entries,
    })),
  }, { wantsPartial, title: 'Forum', state });
  return sendHtml(res, html, {}, threadId ? 404 : 200);
}

function readCollectionQuery(searchParams) {
  return { q: sanitizeText(searchParams.get('q') || '', 120), page: parsePage(searchParams.get('page')) };
}

function findForumThread(state, id) {
  return findVisibleEntry(state.discussions, state, (entry) => entry.id === id && isForumThread(entry));
}
