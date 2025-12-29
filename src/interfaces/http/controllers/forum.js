import { randomUUID } from 'node:crypto';

import { getPerson } from '../../modules/identity/person.js';
import { classifyTopic } from '../../modules/topics/classification.js';
import { evaluateAction } from '../../modules/circle/policy.js';
import { persistDiscussions } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRedirect } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderForum } from '../views/forumView.js';
import { renderPage } from '../views/templates.js';

export async function renderForumRoute({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const forumEntries = filterVisibleEntries(state.discussions, state).filter((entry) => {
    if (entry.petitionId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return true;
    return Boolean(entry.parentId);
  });
  const html = await renderPage(
    'forum',
    renderForum(forumEntries, person),
    { wantsPartial, title: 'Forum' },
  );
  return sendHtml(res, html);
}

export async function postThread({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
  }
  const body = await readRequestBody(req);
  const title = sanitizeText(body.title || '', 160);
  const content = sanitizeText(body.content || '', 1200);
  if (!title || !content) {
    return sendJson(res, 400, { error: 'missing_fields' });
  }
  const topic = await classifyTopic(`${title} ${content}`, state);
  const entry = {
    id: randomUUID(),
    topic,
    stance: 'article',
    title,
    content,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId: null,
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  if (wantsPartial) {
    const html = await renderPage('forum', renderForum(filterVisibleEntries(state.discussions, state), person), { wantsPartial: true, title: 'Forum' });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/forum');
}

export async function postComment({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
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
  const entry = {
    id: randomUUID(),
    topic: parent.topic,
    stance: 'comment',
    title: '',
    content,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId,
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  if (wantsPartial) {
    const html = await renderPage('forum', renderForum(filterVisibleEntries(state.discussions, state), person), { wantsPartial: true, title: 'Forum' });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/forum');
}
