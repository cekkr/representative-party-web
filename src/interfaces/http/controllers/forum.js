import { randomUUID } from 'node:crypto';

import { getPerson } from '../../../modules/identity/person.js';
import { classifyTopic } from '../../../modules/topics/classification.js';
import { ensureTopicPath } from '../../../modules/topics/registry.js';
import { evaluateAction, getCirclePolicyState } from '../../../modules/circle/policy.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { persistDiscussions } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { renderForum } from '../views/forumView.js';
import { renderPage } from '../views/templates.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../../modules/identity/rateLimit.js';
import { recordRateLimit } from '../../../modules/ops/metrics.js';

export async function renderForumRoute({ req, res, state, wantsPartial }) {
  return renderForumPage({ req, res, state, wantsPartial });
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
    return renderForumPage({ req, res, state, wantsPartial, person });
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
    payload: { threadId: parentId },
  });
  if (wantsPartial) {
    return renderForumPage({ req, res, state, wantsPartial, person });
  }
  return sendRedirect(res, '/forum');
}

async function renderForumPage({ req, res, state, wantsPartial, person }) {
  const activePerson = person || getPerson(req, state);
  const forumEntries = filterForumEntries(state);
  const html = await renderPage('forum', renderForum(forumEntries, activePerson, state), { wantsPartial, title: 'Forum', state });
  return sendHtml(res, html);
}

function filterForumEntries(state) {
  return filterVisibleEntries(state.discussions, state).filter((entry) => {
    if (entry.petitionId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return true;
    return Boolean(entry.parentId);
  });
}
