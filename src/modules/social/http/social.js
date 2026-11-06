import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { getPerson } from '../../identity/person.js';
import { evaluateAction } from '../../circle/policy.js';
import { isModuleEnabled } from '../../circle/modules.js';
import { MEDIA, PATHS } from '../../../config.js';
import { persistSocialFollows, persistSocialPosts, persistSocialMedia } from '../../../infra/persistence/storage.js';
import {
  DEFAULT_FOLLOW_TYPES,
  ensureFollowEdge,
  findSessionByHandle,
  normalizeFollowType,
  removeFollowEdge,
  summarizeFollows,
} from '../../social/followGraph.js';
import { buildFeed, canReadSocialPost, createPost, findPost, invalidatePostIndex } from '../../social/posts.js';
import {
  createMedia,
  findMedia,
  hasBlockedMedia,
  recordMediaViewRequest,
  reportMedia,
} from '../../social/media.js';
import { notifyMediaViewRequest, notifySocialParticipants } from '../../social/notifications.js';
import { findReadableSocialPost, socialPostHref } from '../../social/socialLinks.js';
import { logTransaction } from '../../transactions/registry.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readMultipartForm, readRequestBody, deriveBaseUrl } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderFollowList, renderSocialPosts } from '../../../interfaces/http/views/socialView.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../../../interfaces/http/views/moduleGate.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { renderActorAvatar, renderActorLabel, resolveHandleForHash } from '../../../interfaces/http/views/actorLabel.js';
import { findSessionByHash } from '../../identity/sessions.js';
import { recordRateLimit } from '../../ops/metrics.js';

export async function renderSocialFeed({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'social')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'social' });
  }
  const person = getPerson(req, state);
  if (url.searchParams.has('post')) {
    return renderFocusedSocialPost({ res, state, person, wantsPartial, url });
  }
  const requestedType = url.searchParams.get('type');
  const followTypeFilter = person && requestedType ? normalizeFollowType(requestedType) : '';
  const openReplyId = url.searchParams.get('reply') || '';
  const openReshareId = url.searchParams.get('reshare') || '';
  const followStats = summarizeFollows(state, person?.pidHash);
  const allFollows = followStats.follows;
  const feed = buildFeed(state, person, { followType: followTypeFilter || undefined, follows: allFollows });
  const feedPage = paginate(feed, { page: parsePage(url.searchParams.get('page')) });
  const feedPager = renderPager(feedPage, {
    baseHref: '/social/feed',
    query: { type: followTypeFilter || '' },
    label: 'posts',
  });
  const followTypeByHash = followStats.followTypeByHash;
  const followTypeCounts = followStats.followTypeCounts;
  const followTypeList = buildFollowTypeList(followTypeCounts);
  const filterTypes = followTypeFilter && !followTypeList.includes(followTypeFilter)
    ? [...followTypeList, followTypeFilter]
    : followTypeList;
  const mediaById = buildMediaLookup(feedPage.items, state);
  const permission = evaluateAction(state, person, 'post');
  const composeParams = new URLSearchParams();
  if (followTypeFilter) composeParams.set('type', followTypeFilter);
  if (feedPage.page > 1) composeParams.set('page', feedPage.page);
  composeParams.set('compose', 'post');
  const workspaceCreateHref = permission.allowed ? `/social/feed?${composeParams}#social-compose` : '';
  const canManageFollows = Boolean(person && permission.allowed);

  const html = await renderPage(
    'social',
    {
      person,
      workspaceCreateHref,
      socialScope: person ? 'Updates from your network and direct messages.' : 'Public updates.',
      socialPrimaryAction: workspaceCreateHref
        ? `<a class="cta" href="${escapeHtml(workspaceCreateHref)}" data-social-compose-link data-partial>New update</a>`
        : permission.reason === 'verification_required'
          ? '<a class="cta" href="/auth/eudi" data-partial>Verify to post</a>' : '',
      socialPostingNotice: permission.allowed ? '' : escapeHtml(permission.message || 'Posting is unavailable.'),
      socialComposerHidden: permission.allowed ? '' : 'hidden',
      socialComposerActor: permission.allowed && person?.pidHash
        ? `${renderActorAvatar(state, person.pidHash, { size: 'sm' })} ${renderActorLabel(state, person.pidHash)}`
        : 'Posting as a guest',
      socialFollowsHidden: person ? '' : 'hidden',
      socialFollowFormHidden: canManageFollows ? '' : 'hidden',
      socialFollowSummary: `${allFollows.length} following · ${followStats.followerCount} followers`,
      followList: renderFollowList(allFollows, state),
      feedList: renderSocialPosts(feedPage.items, {
        enableActions: permission.allowed,
        viewerHash: person?.pidHash,
        createHref: workspaceCreateHref,
        canManageFollows,
        followTypeFilter,
        followTypeByHash,
        mediaById,
        openReplyId,
        openReshareId,
        resolveParent: (id) => findReadableSocialPost(state, person, id),
        state,
      }),
      feedPager,
      followTypeOptions: renderFollowTypeOptions(followTypeFilter, followTypeCounts, { types: filterTypes }),
      followTypeDatalistOptions: renderFollowTypeOptions('', followTypeCounts, { includeCounts: false, types: followTypeList }),
      followPeopleDatalist: canManageFollows ? renderFollowPeopleOptions(state, person) : '',
      socialFilterSummary: followTypeFilter ? ` · ${escapeHtml(followTypeFilter)}` : '',
      socialFilterOpen: followTypeFilter ? 'open' : '',
      socialClearFilter: followTypeFilter ? '<a href="/social/feed" data-partial>Clear filter</a>' : '',
      followTypeSelectedAll: followTypeFilter ? '' : 'selected',
      followTypeAllLabel: buildFollowTypeAllLabel(allFollows.length),
      composeState: url.searchParams.has('compose') ? 'open' : '',
    },
    { wantsPartial, title: 'Social feed', state },
  );

  return sendHtml(res, html);
}

export async function postSocialMessage({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting blocked.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'social_post', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'social_post');
    return sendRateLimit(res, {
      action: 'social_post',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  let body = {};
  let files = [];
  if (contentType.includes('multipart/form-data')) {
    try {
      const parsed = await readMultipartForm(req, {
        maxBytes: MEDIA.maxBytes + 512 * 1024,
        maxFieldBytes: MEDIA.maxFieldBytes,
        maxFieldBytesTotal: MEDIA.maxFieldBytesTotal,
        maxFieldCount: MEDIA.maxFieldCount,
        maxFieldNameBytes: MEDIA.maxFieldNameBytes,
        maxHeaderBytes: MEDIA.maxHeaderBytes,
        maxFilenameBytes: MEDIA.maxFilenameBytes,
        streamFiles: true,
      });
      body = parsed.fields || {};
      files = parsed.files || [];
    } catch (error) {
      if (error.code === 'payload_too_large') {
        return sendJson(res, 413, {
          error: 'media_too_large',
          message: `Upload exceeds the ${Math.round(MEDIA.maxBytes / (1024 * 1024))}MB limit.`,
        });
      }
      if (error.code === 'field_too_large') {
        return sendJson(res, 413, {
          error: 'field_too_large',
          message: `Form field exceeds the ${Math.round(MEDIA.maxFieldBytes / 1024)}KB limit.`,
        });
      }
      if (error.code === 'fields_too_large') {
        return sendJson(res, 413, {
          error: 'fields_too_large',
          message: `Form fields exceed the ${Math.round(MEDIA.maxFieldBytesTotal / 1024)}KB total limit.`,
        });
      }
      if (error.code === 'too_many_fields') {
        return sendJson(res, 413, {
          error: 'too_many_fields',
          message: `Form exceeds the ${MEDIA.maxFieldCount} field limit.`,
        });
      }
      if (error.code === 'field_name_too_large') {
        return sendJson(res, 413, {
          error: 'field_name_too_large',
          message: `Field name exceeds the ${MEDIA.maxFieldNameBytes} byte limit.`,
        });
      }
      if (error.code === 'headers_too_large') {
        return sendJson(res, 413, {
          error: 'headers_too_large',
          message: `Form headers exceed the ${Math.round(MEDIA.maxHeaderBytes / 1024)}KB limit.`,
        });
      }
      if (error.code === 'filename_too_large') {
        return sendJson(res, 413, {
          error: 'filename_too_large',
          message: `Filename exceeds the ${MEDIA.maxFilenameBytes} byte limit.`,
        });
      }
      throw error;
    }
  } else {
    body = await readRequestBody(req);
  }

  try {
    return await publishSocialPost({ req, res, state, person, body, files });
  } finally {
    // The multipart reader hands ownership of its temporary files to this handler.
    await Promise.allSettled(files.filter((file) => file.tempPath).map((file) => unlink(file.tempPath)));
  }
}

async function publishSocialPost({ req, res, state, person, body, files }) {
  const content = body.content || '';
  const replyTo = body.replyTo || null;
  const reshareOf = sanitizeText(body.reshareOf || '', 120) || null;
  const isReshare = Boolean(reshareOf);
  const mediaFiles = files.filter((file) => file.fieldName === 'media');
  let visibility = isReshare ? 'public' : body.visibility === 'direct' ? 'direct' : 'public';
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
    if (!canReadSocialPost(state, person, resharePost)) {
      return sendJson(res, 404, { error: 'missing_reshare', message: 'Cannot reshare: original post not found.' });
    }
    if (resharePost.visibility === 'direct') {
      return sendJson(res, 400, { error: 'reshare_private', message: 'Direct posts cannot be reshared.' });
    }
    if (hasBlockedMedia(state, resharePost)) {
      return sendJson(res, 403, { error: 'reshare_blocked', message: 'Cannot reshare: media has been blocked.' });
    }
  }

  const parent = replyTo ? findPost(state, replyTo) : null;
  if (replyTo && !canReadSocialPost(state, person, parent)) {
    return sendJson(res, 404, { error: 'missing_parent', message: 'Cannot reply: parent post not found.' });
  }
  if (parent?.visibility === 'direct') {
    visibility = 'direct';
    targetHash = parent.authorHash === person?.pidHash ? parent.targetHash : parent.authorHash;
    targetSession = findSessionByHash(state, targetHash);
    targetHandle = targetHash ? resolveHandleForHash(state, targetHash) : '';
  } else if (visibility === 'direct') {
    targetSession = findSessionByHandle(state, targetHandleInput || '');
    if (!targetSession) {
      return sendJson(res, 404, { error: 'target_not_found', message: 'Target handle not found for direct post.' });
    }
    targetHash = targetSession.pidHash;
    targetHandle = targetSession.handle || targetHandleInput || '';
  } else if (!isReshare && targetHandleInput) {
    return sendJson(res, 400, { error: 'audience_mismatch', message: 'Choose Direct to send to a recipient handle.' });
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
    invalidatePostIndex(state);
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

  // A reply lands in its conversation; a new update returns to the wall.
  return sendRedirect(res, replyTo ? socialPostHref(replyTo, { anchor: 'social-replies' }) : '/social/feed');
}

// One update, its readable parent, and its readable replies oldest-first. The
// audience gate is the same one replies, reshares, and media use, so a direct
// message opens only for its two participants.
async function renderFocusedSocialPost({ res, state, person, wantsPartial, url }) {
  const postId = sanitizeText(url.searchParams.get('post') || '', 120);
  const post = findReadableSocialPost(state, person, postId);
  const permission = evaluateAction(state, person, 'post');
  if (!post) {
    const html = await renderPage('social-post', {
      person,
      pageKey: 'social',
      socialPostTitle: 'Update unavailable',
      socialPostScope: 'This update does not exist or is not shared with you.',
      socialPostBody: '<p class="muted">This update could not be opened.</p>',
      socialRepliesHidden: 'hidden',
    }, { wantsPartial, title: 'Social update', state });
    return sendHtml(res, html, {}, 404);
  }
  const parent = post.replyTo ? findReadableSocialPost(state, person, post.replyTo) : null;
  const replies = (state.socialPosts || [])
    .filter((entry) => entry.replyTo === post.id && findReadableSocialPost(state, person, entry.id))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const handle = post.authorHash ? resolveHandleForHash(state, post.authorHash) : (post.authorHandle || 'anonymous');
  const direct = post.visibility === 'direct';
  const renderOptions = {
    enableActions: permission.allowed,
    viewerHash: person?.pidHash,
    mediaById: buildMediaLookup([post, ...replies], state),
    openReplyId: url.searchParams.get('reply') || '',
    openReshareId: url.searchParams.get('reshare') || '',
    resolveParent: (id) => (id === post.id ? post : findReadableSocialPost(state, person, id)),
    focusedId: post.id,
    state,
  };
  const html = await renderPage('social-post', {
    person,
    pageKey: 'social',
    socialPostTitle: escapeHtml(direct ? `Direct message from @${handle}` : `Update from @${handle}`),
    socialPostScope: escapeHtml(direct
      ? 'Only the sender and recipient can read this conversation.'
      : 'Public update. Replies keep their own audience.'),
    socialPostParent: parent
      ? `<p class="muted small">In reply to <a href="${escapeHtml(socialPostHref(parent.id))}" data-partial>@${escapeHtml(resolveHandleForHash(state, parent.authorHash))}</a></p>`
      : '',
    socialPostAction: permission.allowed
      ? `<a class="cta" href="${escapeHtml(socialPostHref(post.id))}&amp;reply=${escapeHtml(encodeURIComponent(post.id))}#social-post-${escapeHtml(post.id)}" data-partial>Reply</a>`
      : '',
    socialPostBody: renderSocialPosts([post], renderOptions),
    socialReplyCount: String(replies.length),
    socialReplies: replies.length
      ? renderSocialPosts(replies, { ...renderOptions, enableActions: permission.allowed })
      : '<p class="muted">No replies yet.</p>',
    socialRepliesHidden: '',
  }, { wantsPartial, title: direct ? 'Direct message' : `Update from @${handle}`, state });
  return sendHtml(res, html);
}

export async function serveSocialMedia({ req, res, state, params }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
  }
  const mediaId = params?.mediaId || '';
  const media = findMedia(state, mediaId);
  const person = getPerson(req, state);
  if (!media || !canReadSocialPost(state, person, findPost(state, media.postId))) {
    return sendJson(res, 404, { error: 'media_not_found', message: 'Media not found.' });
  }
  if (media.status === 'blocked') {
    return sendJson(res, 451, { error: 'media_blocked', message: 'Media blocked by provider policy.' });
  }

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
    const viewerHash = person?.pidHash || '';
    const isNewViewer = viewerHash ? !((media.viewers || []).includes(viewerHash)) : false;
    const updatedMedia = recordMediaViewRequest(state, media, { actorHash: viewerHash });
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
    if (isNewViewer && media.status === 'locked') {
      await notifyMediaViewRequest(state, { media: updatedMedia || media, viewer: person });
    }
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

export async function reportSocialMedia({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
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
    recordRateLimit(state, 'social_media_report');
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
  if (!media || !canReadSocialPost(state, person, findPost(state, media.postId))) {
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

  return sendRedirect(res, '/social/feed');
}

export async function followHandle({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
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

  return sendRedirect(res, '/social/feed');
}

export async function unfollowHandle({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
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

  return sendRedirect(res, '/social/feed');
}

export async function listRelationships({ req, res, state }) {
  if (!isModuleEnabled(state, 'social')) {
    return sendModuleDisabledJson({ res, moduleKey: 'social', state });
  }
  const person = getPerson(req, state);
  const query = req.url ? new URL(req.url, `http://${req.headers.host}`) : null;
  const handleParam = query?.searchParams.get('handle') || '';
  const targetSession = handleParam ? findSessionByHandle(state, handleParam) : person;

  if (!targetSession) {
    return sendJson(res, 404, { error: 'handle_not_found', message: 'Handle not found.' });
  }

  const followStats = summarizeFollows(state, targetSession.pidHash);
  return sendJson(res, 200, {
    handle: targetSession.handle,
    follows: followStats.follows,
    followers: followStats.followers,
  });
}

function renderFollowTypeOptions(selectedType = '', counts = new Map(), { includeCounts = true, types } = {}) {
  const normalized = selectedType ? normalizeFollowType(selectedType) : '';
  const resolvedTypes = types || buildFollowTypeList(counts);
  return resolvedTypes.map((type) => {
    const selected = normalized === type ? ' selected' : '';
    const count = counts.get(type);
    const label = includeCounts && Number.isFinite(count) && count > 0 ? `${type} (${count})` : type;
    return `<option value="${type}"${selected}>${label}</option>`;
  }).join('\n');
}

function buildMediaLookup(posts = [], state) {
  if (!posts.length) return new Map();
  const needed = new Set();
  for (const post of posts) {
    if (Array.isArray(post.mediaIds)) {
      for (const mediaId of post.mediaIds) {
        if (mediaId) needed.add(mediaId);
      }
    }
    if (post.reshare && Array.isArray(post.reshare.mediaIds)) {
      for (const mediaId of post.reshare.mediaIds) {
        if (mediaId) needed.add(mediaId);
      }
    }
  }
  if (!needed.size) return new Map();
  const lookup = new Map();
  for (const mediaId of needed) {
    const media = findMedia(state, mediaId);
    if (!media) continue;
    lookup.set(mediaId, media);
  }
  return lookup;
}

function buildFollowTypeList(counts = new Map()) {
  const extraTypes = [...counts.keys()].filter((type) => !DEFAULT_FOLLOW_TYPES.includes(type)).sort();
  return [...DEFAULT_FOLLOW_TYPES, ...extraTypes];
}

function buildFollowTypeAllLabel(count) {
  const total = Number.isFinite(count) ? count : 0;
  return total > 0 ? `All (${total})` : 'All';
}

// Datalist of verified people (with chosen handles) so the follow field autocompletes
// real handles instead of asking the user to recall a generated identifier. Self excluded.
function renderFollowPeopleOptions(state, person) {
  const sessions = state?.sessions ? [...state.sessions.values()] : [];
  const seen = new Set();
  const options = [];
  for (const session of sessions) {
    if (!session || session.status !== 'verified' || !session.handle) continue;
    if (session.pidHash && session.pidHash === person?.pidHash) continue;
    const handle = String(session.handle);
    if (seen.has(handle.toLowerCase())) continue;
    seen.add(handle.toLowerCase());
    const role = session.role || 'user';
    options.push(`<option value="${escapeHtml(handle)}">@${escapeHtml(handle)} · ${escapeHtml(role)}</option>`);
  }
  return options.join('\n');
}
