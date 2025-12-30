import { getPerson } from '../../modules/identity/person.js';
import { evaluateAction } from '../../modules/circle/policy.js';
import { isModuleEnabled } from '../../modules/circle/modules.js';
import { persistSocialFollows, persistSocialPosts } from '../../infra/persistence/storage.js';
import {
  DEFAULT_FOLLOW_TYPES,
  ensureFollowEdge,
  findSessionByHandle,
  listFollowersOf,
  listFollowsFor,
  normalizeFollowType,
  removeFollowEdge,
} from '../../modules/social/followGraph.js';
import { buildFeed, createPost, findPost } from '../../modules/social/posts.js';
import { notifySocialParticipants } from '../../modules/social/notifications.js';
import { sendHtml, sendJson, sendRedirect } from '../../shared/utils/http.js';
import { readRequestBody, deriveBaseUrl } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderFollowList, renderSocialPosts } from '../views/socialView.js';
import { deriveStatusMeta, renderStatusStrip } from '../views/status.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';

export async function renderSocialFeed({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  const followTypeFilter = url.searchParams.get('type') || '';
  const feed = buildFeed(state, person, { followType: followTypeFilter || undefined });
  const follows = person ? listFollowsFor(state, person.pidHash, followTypeFilter || undefined) : [];
  const followers = person ? listFollowersOf(state, person.pidHash) : [];
  const permission = evaluateAction(state, person, 'post');
  const statusMeta = deriveStatusMeta(state);

  const html = await renderPage(
    'social',
    {
      personHandle: person?.handle || 'Guest session',
      roleLabel: person?.role || 'guest',
      postingStatus: permission.allowed ? 'Posting allowed.' : 'Posting blocked.',
      postingReason: permission.message || permission.reason || '',
      followCount: follows.length,
      followerCount: followers.length,
      followList: renderFollowList(follows),
      feedList: renderSocialPosts(feed, { enableReplies: Boolean(person) }),
      followTypeOptions: renderFollowTypeOptions(followTypeFilter),
      followTypeFilter,
      followTypeSelectedAll: followTypeFilter ? '' : 'selected',
      statusStrip: renderStatusStrip(statusMeta),
    },
    { wantsPartial, title: 'Social feed', state },
  );

  return sendHtml(res, html);
}

export async function postSocialMessage({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting blocked.' });
  }

  const body = await readRequestBody(req);
  const content = body.content || '';
  const replyTo = body.replyTo || null;
  const reshareOf = sanitizeText(body.reshareOf || '', 120) || null;
  const isReshare = Boolean(reshareOf);
  const visibility = isReshare ? 'public' : body.visibility === 'direct' ? 'direct' : 'public';
  let targetHash = '';
  let targetHandle = '';
  let targetSession = null;
  let resharePost = null;

  if (replyTo && isReshare) {
    return sendJson(res, 400, { error: 'conflicting_intent', message: 'Reply and reshare cannot be combined.' });
  }

  if (isReshare) {
    resharePost = findPost(state, reshareOf);
    if (!resharePost) {
      return sendJson(res, 404, { error: 'missing_reshare', message: 'Cannot reshare: original post not found.' });
    }
    if (resharePost.visibility === 'direct') {
      return sendJson(res, 400, { error: 'reshare_private', message: 'Direct posts cannot be reshared.' });
    }
  }

  if (!isReshare && (visibility === 'direct' || body.targetHandle)) {
    targetSession = findSessionByHandle(state, body.targetHandle || '');
    if (!targetSession) {
      return sendJson(res, 404, { error: 'target_not_found', message: 'Target handle not found for direct post.' });
    }
    targetHash = targetSession.pidHash;
    targetHandle = targetSession.handle || body.targetHandle || '';
  }

  if (replyTo) {
    const parent = findPost(state, replyTo);
    if (!parent) {
      return sendJson(res, 404, { error: 'missing_parent', message: 'Cannot reply: parent post not found.' });
    }
  }

  try {
    const baseUrl = deriveBaseUrl(req);
    const post = createPost(state, {
      person,
      content,
      replyTo,
      visibility,
      targetHash,
      targetHandle,
      baseUrl,
      reshareOf: isReshare ? reshareOf : null,
      resharePost,
    });
    await persistSocialPosts(state);
    await notifySocialParticipants(state, { post, author: person, targetSession });
  } catch (error) {
    if (error.code === 'missing_content') {
      return sendJson(res, 400, { error: 'missing_content' });
    }
    if (error.code === 'missing_target') {
      return sendJson(res, 400, { error: 'missing_target', message: 'Direct posts require a target handle.' });
    }
    if (error.code === 'missing_reshare') {
      return sendJson(res, 404, { error: 'missing_reshare', message: 'Cannot reshare: original post not found.' });
    }
    if (error.code === 'reshare_private') {
      return sendJson(res, 400, { error: 'reshare_private', message: 'Direct posts cannot be reshared.' });
    }
    if (error.code === 'conflicting_intent') {
      return sendJson(res, 400, { error: 'conflicting_intent', message: 'Reply and reshare cannot be combined.' });
    }
    throw error;
  }

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function followHandle({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to follow.' });
  }

  const body = await readRequestBody(req);
  const handle = sanitizeText(body.handle || '', 64);
  const followType = normalizeFollowType(body.type || 'circle');
  const targetSession = findSessionByHandle(state, handle);
  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }
  if (targetSession.pidHash === person.pidHash) {
    return sendJson(res, 400, { error: 'invalid_target', message: 'You cannot follow yourself.' });
  }

  ensureFollowEdge(state, {
    followerHash: person.pidHash,
    targetHash: targetSession.pidHash,
    targetHandle: targetSession.handle,
    type: followType,
  });
  await persistSocialFollows(state);

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function unfollowHandle({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to unfollow.' });
  }

  const body = await readRequestBody(req);
  const handle = sanitizeText(body.handle || '', 64);
  const targetSession = findSessionByHandle(state, handle);
  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }

  removeFollowEdge(state, {
    followerHash: person.pidHash,
    targetHash: targetSession.pidHash,
  });
  await persistSocialFollows(state);

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function listRelationships({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  const query = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;
  const handleParam = query?.searchParams.get('handle') || '';
  const targetSession = handleParam ? findSessionByHandle(state, handleParam) : person;

  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }

  const follows = listFollowsFor(state, targetSession.pidHash);
  const followers = listFollowersOf(state, targetSession.pidHash);
  return sendJson(res, 200, {
    handle: targetSession.handle,
    follows,
    followers,
  });
}

function renderFollowTypeOptions(selectedType = '') {
  const normalized = selectedType ? normalizeFollowType(selectedType) : '';
  return DEFAULT_FOLLOW_TYPES.map((type) => {
    const selected = normalized === type ? ' selected' : '';
    return `<option value="${type}"${selected}>${type}</option>`;
  }).join('\n');
}
