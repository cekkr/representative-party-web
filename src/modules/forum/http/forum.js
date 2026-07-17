import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { classifyTopic } from '../../topics/classification.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { evaluateAction, getCirclePolicyState } from '../../circle/policy.js';
import { logTransaction } from '../../transactions/registry.js';
import { persistDiscussions } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { renderForum } from '../../../interfaces/http/views/forumView.js';
import { parsePage } from '../../../shared/utils/pagination.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { recordRateLimit } from '../../ops/metrics.js';

export async function renderForumRoute({ req, res, state, wantsPartial, url }) {
  return renderForumPage({ req, res, state, wantsPartial, url });
}

export async function postThread({ req, res, state, wantsPartial }) {
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
  const classifiedTopic = await classifyTopic(`${title} ${content}`, state);
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
  if (wantsPartial) {
    return renderForumPage({ req, res, state, wantsPartial, person, url: new URL(req.url, `http://${req.headers.host}`) });
  }
  return sendRedirect(res, '/forum');
}

export async function postComment({ req, res, state, wantsPartial }) {
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
  const parent = state.discussions.find((d) => d.id === parentId && !d.parentId);
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
  if (wantsPartial) {
    return renderForumPage({ req, res, state, wantsPartial, person, url: new URL(req.url, `http://${req.headers.host}`) });
  }
  return sendRedirect(res, '/forum');
}

async function renderForumPage({ req, res, state, wantsPartial, person, url }) {
  const activePerson = person || getPerson(req, state);
  const resolvedUrl = url || new URL(req.url, `http://${req.headers.host}`);
  const composeOpen = resolvedUrl.searchParams.get('compose') ? 'open' : '';
  const replyOpenId = resolvedUrl.searchParams.get('reply') || '';
  const page = parsePage(resolvedUrl.searchParams.get('page'));
  const forumEntries = filterForumEntries(state);
  const postGate = evaluateAction(state, activePerson, 'post');
  const forumData = renderForum(forumEntries, activePerson, state, { composeOpen, replyOpenId, page, postGate });
  forumData.person = activePerson;
  const html = await renderPage('forum', forumData, { wantsPartial, title: 'Forum', state });
  return sendHtml(res, html);
}

function filterForumEntries(state) {
  return filterVisibleEntries(state.discussions, state, (entry) => {
    if (entry.petitionId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return true;
    return Boolean(entry.parentId);
  });
}
