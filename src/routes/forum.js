import { randomUUID } from 'node:crypto';

import { getCitizen } from '../services/citizen.js';
import { classifyTopic } from '../services/classification.js';
import { evaluateAction } from '../services/policy.js';
import { persistDiscussions } from '../state/storage.js';
import { sendHtml, sendJson, sendRedirect } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';
import { renderForum } from '../views/forumView.js';
import { renderPage } from '../views/templates.js';

export async function renderForumRoute({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const html = await renderPage(
    'forum',
    renderForum(state.discussions, citizen),
    { wantsPartial, title: 'Forum' },
  );
  return sendHtml(res, html);
}

export async function postThread({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'post');
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
    authorHash: citizen?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId: null,
  };
  state.discussions.unshift(entry);
  await persistDiscussions(state);
  if (wantsPartial) {
    const html = await renderPage('forum', renderForum(state.discussions, citizen), { wantsPartial: true, title: 'Forum' });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/forum');
}

export async function postComment({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'post');
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
    authorHash: citizen?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    parentId,
  };
  state.discussions.unshift(entry);
  await persistDiscussions(state);
  if (wantsPartial) {
    const html = await renderPage('forum', renderForum(state.discussions, citizen), { wantsPartial: true, title: 'Forum' });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/forum');
}
