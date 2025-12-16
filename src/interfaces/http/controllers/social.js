import { getCitizen } from '../../modules/identity/citizen.js';
import { evaluateAction } from '../../modules/circle/policy.js';
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
import { sendHtml, sendJson, sendRedirect } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderFollowList, renderSocialPosts } from '../views/socialView.js';

export async function renderSocialFeed({ req, res, state, wantsPartial, url }) {
  const citizen = getCitizen(req, state);
  const followTypeFilter = url.searchParams.get('type') || '';
  const feed = buildFeed(state, citizen, { followType: followTypeFilter || undefined });
  const follows = citizen ? listFollowsFor(state, citizen.pidHash, followTypeFilter || undefined) : [];
  const followers = citizen ? listFollowersOf(state, citizen.pidHash) : [];
  const permission = evaluateAction(state, citizen, 'post');

  const html = await renderPage(
    'social',
    {
      citizenHandle: citizen?.handle || 'Guest session',
      roleLabel: citizen?.role || 'guest',
      postingStatus: permission.allowed ? 'Posting allowed.' : 'Posting blocked.',
      postingReason: permission.message || permission.reason || '',
      followCount: follows.length,
      followerCount: followers.length,
      followList: renderFollowList(follows),
      feedList: renderSocialPosts(feed),
      followTypeOptions: renderFollowTypeOptions(),
    },
    { wantsPartial, title: 'Social feed' },
  );

  return sendHtml(res, html);
}

export async function postSocialMessage({ req, res, state, wantsPartial, url }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting blocked.' });
  }

  const body = await readRequestBody(req);
  const content = body.content || '';
  const visibility = body.visibility === 'direct' ? 'direct' : 'public';
  const replyTo = body.replyTo || null;
  let targetHash = '';
  let targetHandle = '';

  if (visibility === 'direct' || body.targetHandle) {
    const targetSession = findSessionByHandle(state, body.targetHandle || '');
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
    createPost(state, { citizen, content, replyTo, visibility, targetHash, targetHandle });
    await persistSocialPosts(state);
  } catch (error) {
    if (error.code === 'missing_content') {
      return sendJson(res, 400, { error: 'missing_content' });
    }
    if (error.code === 'missing_target') {
      return sendJson(res, 400, { error: 'missing_target', message: 'Direct posts require a target handle.' });
    }
    throw error;
  }

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function followHandle({ req, res, state, wantsPartial, url }) {
  const citizen = getCitizen(req, state);
  if (!citizen) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to follow.' });
  }

  const body = await readRequestBody(req);
  const handle = sanitizeText(body.handle || '', 64);
  const followType = normalizeFollowType(body.type || 'circle');
  const targetSession = findSessionByHandle(state, handle);
  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }
  if (targetSession.pidHash === citizen.pidHash) {
    return sendJson(res, 400, { error: 'invalid_target', message: 'You cannot follow yourself.' });
  }

  ensureFollowEdge(state, {
    followerHash: citizen.pidHash,
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
  const citizen = getCitizen(req, state);
  if (!citizen) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to unfollow.' });
  }

  const body = await readRequestBody(req);
  const handle = sanitizeText(body.handle || '', 64);
  const targetSession = findSessionByHandle(state, handle);
  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }

  removeFollowEdge(state, {
    followerHash: citizen.pidHash,
    targetHash: targetSession.pidHash,
  });
  await persistSocialFollows(state);

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function listRelationships({ req, res, state }) {
  const citizen = getCitizen(req, state);
  const query = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;
  const handleParam = query?.searchParams.get('handle') || '';
  const targetSession = handleParam ? findSessionByHandle(state, handleParam) : citizen;

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

function renderFollowTypeOptions() {
  return DEFAULT_FOLLOW_TYPES.map((type) => `<option value="${type}">${type}</option>`).join('\n');
}
