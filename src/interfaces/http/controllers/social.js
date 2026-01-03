import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction } from '../../../modules/circle/policy.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { MEDIA, PATHS } from '../../../config.js';
import { persistSocialFollows, persistSocialPosts, persistSocialMedia } from '../../../infra/persistence/storage.js';
import {
  DEFAULT_FOLLOW_TYPES,
  ensureFollowEdge,
  findSessionByHandle,
  listFollowersOf,
  listFollowsFor,
  normalizeFollowType,
  removeFollowEdge,
} from '../../../modules/social/followGraph.js';
import { buildFeed, createPost, findPost } from '../../../modules/social/posts.js';
import {
  createMedia,
  findMedia,
  hasBlockedMedia,
  recordMediaViewRequest,
  reportMedia,
} from '../../../modules/social/media.js';
import { notifySocialParticipants } from '../../../modules/social/notifications.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readMultipartForm, readRequestBody, deriveBaseUrl } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderFollowList, renderSocialPosts } from '../views/socialView.js';
import { deriveStatusMeta, renderStatusStrip } from '../views/status.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../../modules/identity/rateLimit.js';
import { resolvePersonHandle } from '../views/actorLabel.js';

export async function renderSocialFeed({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  const followTypeFilter = url.searchParams.get('type') || '';
  const feed = buildFeed(state, person, { followType: followTypeFilter || undefined });
  const follows = person ? listFollowsFor(state, person.pidHash, followTypeFilter || undefined) : [];
  const followers = person ? listFollowersOf(state, person.pidHash) : [];
  const followTypeByHash = new Map(follows.map((edge) => [edge.targetHash, edge.type]));
  const mediaById = new Map((state.socialMedia || []).map((media) => [media.id, media]));
  const permission = evaluateAction(state, person, 'post');
  const postingReason = permission.allowed ? '' : permission.message || permission.reason || '';
  const statusMeta = deriveStatusMeta(state);

  const html = await renderPage(
    'social',
    {
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      postingStatus: permission.allowed ? 'Posting allowed.' : 'Posting blocked.',
      postingReason,
      followCount: follows.length,
      followerCount: followers.length,
      followList: renderFollowList(follows),
      feedList: renderSocialPosts(feed, { enableReplies: Boolean(person), followTypeByHash, mediaById }),
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
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'social_post', actorKey });
  if (!rateLimit.allowed) {
    return sendRateLimit(res, {
      action: 'social_post',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const contentType = req.headers['content-type'] || '';
  let body = {};
  let files = [];
  if (contentType.includes('multipart/form-data')) {
    try {
      const parsed = await readMultipartForm(req, { maxBytes: MEDIA.maxBytes + 512 * 1024 });
      body = parsed.fields || {};
      files = parsed.files || [];
    } catch (error) {
      if (error.code === 'payload_too_large') {
        return sendJson(res, 413, {
          error: 'media_too_large',
          message: `Upload exceeds the ${Math.round(MEDIA.maxBytes / (1024 * 1024))}MB limit.`,
        });
      }
      throw error;
    }
  } else {
    body = await readRequestBody(req);
  }
  const content = body.content || '';
  const replyTo = body.replyTo || null;
  const reshareOf = sanitizeText(body.reshareOf || '', 120) || null;
  const isReshare = Boolean(reshareOf);
  const mediaFiles = files.filter((file) => file.fieldName === 'media');
  const visibility = isReshare ? 'public' : body.visibility === 'direct' ? 'direct' : 'public';
  const targetHandleInput = sanitizeText(body.targetHandle || '', 64);
  let targetHash = '';
  let targetHandle = '';
  let targetSession = null;
  let resharePost = null;

  if (replyTo && isReshare) {
    return sendJson(res, 400, { error: 'conflicting_intent', message: 'Reply and reshare cannot be combined.' });
  }
  if (isReshare && mediaFiles.length) {
    return sendJson(res, 400, { error: 'conflicting_intent', message: 'Reshares cannot include media uploads.' });
  }
  if (mediaFiles.length > 1) {
    return sendJson(res, 400, { error: 'too_many_media', message: 'Only one photo or video can be attached per post.' });
  }

  if (isReshare) {
    resharePost = findPost(state, reshareOf);
    if (!resharePost) {
      return sendJson(res, 404, { error: 'missing_reshare', message: 'Cannot reshare: original post not found.' });
    }
    if (resharePost.visibility === 'direct') {
      return sendJson(res, 400, { error: 'reshare_private', message: 'Direct posts cannot be reshared.' });
    }
    if (hasBlockedMedia(state, resharePost)) {
      return sendJson(res, 403, { error: 'reshare_blocked', message: 'Cannot reshare: media has been blocked.' });
    }
  }

  if (!isReshare && (visibility === 'direct' || targetHandleInput)) {
    targetSession = findSessionByHandle(state, targetHandleInput || '');
    if (!targetSession) {
      return sendJson(res, 404, { error: 'target_not_found', message: 'Target handle not found for direct post.' });
    }
    targetHash = targetSession.pidHash;
    targetHandle = targetSession.handle || targetHandleInput || '';
  }

  if (replyTo) {
    const parent = findPost(state, replyTo);
    if (!parent) {
      return sendJson(res, 404, { error: 'missing_parent', message: 'Cannot reply: parent post not found.' });
    }
  }

  try {
    const baseUrl = deriveBaseUrl(req);
    const postId = randomUUID();
    const mediaEntries = [];
    if (mediaFiles[0]) {
      const media = await createMedia(state, { postId, file: mediaFiles[0], person });
      mediaEntries.push(media);
    }
    const post = createPost(state, {
      id: postId,
      person,
      content,
      replyTo,
      visibility,
      targetHash,
      targetHandle,
      baseUrl,
      reshareOf: isReshare ? reshareOf : null,
      resharePost,
      mediaIds: mediaEntries.map((entry) => entry.id),
      persist: false,
    });
    state.socialPosts = [post, ...(state.socialPosts || [])];
    await persistSocialPosts(state);
    if (mediaEntries.length) {
      await persistSocialMedia(state);
      await logTransaction(state, {
        type: 'social_media_upload',
        actorHash: person?.pidHash || 'anonymous',
        payload: {
          postId: post.id,
          mediaId: mediaEntries[0].id,
          contentType: mediaEntries[0].contentType,
          size: mediaEntries[0].size,
          status: mediaEntries[0].status,
        },
      });
    }
    await notifySocialParticipants(state, { post, author: person, targetSession });
    await logTransaction(state, {
      type: 'social_post',
      actorHash: person?.pidHash || 'anonymous',
      payload: {
        postId: post.id,
        visibility: post.visibility,
        replyTo: post.replyTo || null,
        reshareOf: post.reshareOf || null,
        mediaIds: post.mediaIds || [],
      },
    });
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
    if (error.code === 'media_too_large') {
      return sendJson(res, 413, {
        error: 'media_too_large',
        message: `Upload exceeds the ${Math.round(MEDIA.maxBytes / (1024 * 1024))}MB limit.`,
      });
    }
    if (error.code === 'unsupported_media') {
      return sendJson(res, 400, { error: 'unsupported_media', message: 'Only images or videos are supported.' });
    }
    if (error.code === 'missing_media') {
      return sendJson(res, 400, { error: 'missing_media', message: 'Media upload missing from request.' });
    }
    if (error.code === 'empty_media') {
      return sendJson(res, 400, { error: 'empty_media', message: 'Media upload was empty.' });
    }
    throw error;
  }

  if (wantsPartial) {
    return renderSocialFeed({ req, res, state, wantsPartial, url });
  }

  return sendRedirect(res, '/social/feed');
}

export async function serveSocialMedia({ req, res, state, params }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const mediaId = params?.mediaId || '';
  const media = findMedia(state, mediaId);
  if (!media) {
    return sendJson(res, 404, { error: 'media_not_found', message: 'Media not found.' });
  }
  if (media.status === 'blocked') {
    return sendJson(res, 451, { error: 'media_blocked', message: 'Media blocked by provider policy.' });
  }

  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 403, { error: permission.reason, message: permission.message || 'Viewing blocked.' });
  }

  const url = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;
  const viewRequested = url?.searchParams.get('view') === '1';
  if (media.status === 'locked' && !viewRequested) {
    return sendJson(res, 423, { error: 'media_locked', message: 'Media locked. Request with ?view=1.' });
  }

  if (viewRequested) {
    recordMediaViewRequest(state, media, { actorHash: person?.pidHash || '' });
    await persistSocialMedia(state);
    await logTransaction(state, {
      type: 'social_media_view_request',
      actorHash: person?.pidHash || 'anonymous',
      payload: {
        mediaId: media.id,
        postId: media.postId,
        status: media.status,
      },
    });
  }

  if (!media.storedName) {
    return sendJson(res, 404, { error: 'media_missing', message: 'Stored media file missing.' });
  }
  const filePath = join(PATHS.MEDIA_ROOT, media.storedName || '');
  if (!filePath.startsWith(PATHS.MEDIA_ROOT)) {
    return sendJson(res, 400, { error: 'invalid_media_path' });
  }
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return sendJson(res, 404, { error: 'media_missing', message: 'Stored media file missing.' });
    }
    throw error;
  }

  const range = req.headers.range;
  const total = info.size;
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : total - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      const safeEnd = Math.min(end, total - 1);
      const chunkSize = safeEnd - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${safeEnd}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': media.contentType || 'application/octet-stream',
      });
      return createReadStream(filePath, { start, end: safeEnd }).pipe(res);
    }
  }

  res.writeHead(200, {
    'Content-Length': total,
    'Content-Type': media.contentType || 'application/octet-stream',
  });
  return createReadStream(filePath).pipe(res);
}

export async function reportSocialMedia({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to report media.' });
  }
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Report action blocked.' });
  }

  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'social_media_report', actorKey });
  if (!rateLimit.allowed) {
    return sendRateLimit(res, {
      action: 'social_media_report',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const body = await readRequestBody(req);
  const mediaId = sanitizeText(body.mediaId || '', 120);
  const media = findMedia(state, mediaId);
  if (!media) {
    return sendJson(res, 404, { error: 'media_not_found', message: 'Media not found.' });
  }

  const updated = reportMedia(state, media, { reporterHash: person.pidHash, threshold: MEDIA.reportThreshold });
  await persistSocialMedia(state);
  await logTransaction(state, {
    type: 'social_media_report',
    actorHash: person.pidHash,
    payload: {
      mediaId: updated.id,
      postId: updated.postId,
      reportCount: updated.reportCount,
      status: updated.status,
    },
  });

  if (updated.status === 'blocked' && media.status !== 'blocked') {
    await logTransaction(state, {
      type: 'social_media_block',
      actorHash: 'system',
      payload: {
        mediaId: updated.id,
        postId: updated.postId,
        reason: updated.blockedReason || 'mass_report',
      },
    });
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
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Follow action blocked.' });
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
  await logTransaction(state, {
    type: 'social_follow',
    actorHash: person.pidHash,
    payload: { targetHash: targetSession.pidHash, type: followType },
  });

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
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Unfollow action blocked.' });
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
  await logTransaction(state, {
    type: 'social_unfollow',
    actorHash: person.pidHash,
    payload: { targetHash: targetSession.pidHash },
  });

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
