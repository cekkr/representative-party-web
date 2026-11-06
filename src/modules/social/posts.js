import { randomUUID } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';
import { getReplicationProfile, stampLocalEntry } from '../federation/replication.js';
import { createSocialNote, wrapCreateActivity } from '../federation/activitypub.js';
import { listFollowsFor, normalizeFollowType } from './followGraph.js';
import { getEffectivePolicy } from '../circle/policy.js';

const MAX_POST_LENGTH = 560;
const EMPTY_POST_INDEX = { byId: new Map(), version: 0, size: 0 };
const EMPTY_ACTIVITYPUB_INDEX = { byObjectId: new Map(), byActivityId: new Map(), version: 0, size: 0, headId: '', tailId: '' };
const MENTION_REGEX = /@([a-zA-Z0-9._-]{2,64})/g;
const TAG_REGEX = /#([a-zA-Z0-9_-]{2,48})/g;

export function createPost(
  state,
  {
    person,
    content,
    replyTo = null,
    visibility = 'public',
    targetHash = '',
    targetHandle = '',
    baseUrl,
    reshareOf = null,
    resharePost = null,
    mediaIds = [],
    id = null,
    persist = true,
  },
) {
  const body = sanitizeText(content, MAX_POST_LENGTH);
  const wantsReshare = Boolean(reshareOf);
  const normalizedMediaIds = Array.isArray(mediaIds) ? mediaIds.filter(Boolean) : [];
  if (replyTo && wantsReshare) {
    const error = new Error('conflicting_intent');
    error.code = 'conflicting_intent';
    throw error;
  }
  if (!body && !wantsReshare && normalizedMediaIds.length === 0) {
    const error = new Error('missing_content');
    error.code = 'missing_content';
    throw error;
  }

  const normalizedVisibility = visibility === 'direct' ? 'direct' : 'public';
  if (normalizedVisibility === 'direct' && !targetHash) {
    const error = new Error('missing_target');
    error.code = 'missing_target';
    throw error;
  }

  let reshare = null;
  if (wantsReshare) {
    const source = resharePost || findPost(state, reshareOf);
    if (!source) {
      const error = new Error('missing_reshare');
      error.code = 'missing_reshare';
      throw error;
    }
    if (source.visibility === 'direct') {
      const error = new Error('reshare_private');
      error.code = 'reshare_private';
      throw error;
    }
    reshare = {
      id: source.id,
      authorHash: source.authorHash,
      authorHandle: source.authorHandle,
      content: source.content,
      createdAt: source.createdAt,
      mediaIds: Array.isArray(source.mediaIds) ? source.mediaIds : [],
    };
  }

  const mentions = extractMentions(body);
  const tags = extractTags(body);
  const policy = getEffectivePolicy(state);
  const entry = stampLocalEntry(state, {
    id: id || randomUUID(),
    authorHash: person?.pidHash || 'anonymous',
    authorHandle: person?.handle || 'guest',
    content: body,
    createdAt: new Date().toISOString(),
    replyTo: replyTo || null,
    mentions,
    tags,
    reshareOf: reshare ? reshare.id : null,
    reshare,
    visibility: normalizedVisibility,
    targetHash: normalizedVisibility === 'direct' ? targetHash : '',
    targetHandle: normalizedVisibility === 'direct' ? targetHandle : '',
    mediaIds: normalizedMediaIds,
    policyId: policy.id,
    policyVersion: policy.version,
  });

  const note = createSocialNote({ post: entry, baseUrl });
  const activity = wrapCreateActivity({ note, baseUrl });
  entry.activityPub = { note, activity };

  if (persist) {
    state.socialPosts = [entry, ...(state.socialPosts || [])];
    invalidatePostIndex(state);
  }
  return entry;
}

export function buildFeed(state, person, { followType, follows } = {}) {
  const posts = state.socialPosts || [];
  const { allowPreviews } = getReplicationProfile(state);
  if (!person) {
    const feed = [];
    for (const post of posts) {
      if (!post) continue;
      if (!allowPreviews && post?.validationStatus === 'preview') continue;
      if (post.visibility === 'direct') continue;
      feed.push(post);
      if (feed.length >= 80) break;
    }
    return feed;
  }

  const ownHash = person.pidHash;
  const normalizedType = followType ? normalizeFollowType(followType) : null;
  const followList = Array.isArray(follows) ? follows : listFollowsFor(state, ownHash, normalizedType || undefined);
  const filteredFollows = normalizedType ? followList.filter((edge) => edge.type === normalizedType) : followList;
  const followedHashes = new Set([ownHash]);
  for (const edge of filteredFollows) {
    followedHashes.add(edge.targetHash);
  }

  const feed = [];
  for (const post of posts) {
    if (!post) continue;
    if (!allowPreviews && post?.validationStatus === 'preview') continue;
    const isAuthorFollowed = followedHashes.has(post.authorHash);
    const isDirect = post.visibility === 'direct';
    const isRecipient = post.targetHash && post.targetHash === ownHash;
    if (isDirect && !(post.authorHash === ownHash || isRecipient)) continue;
    if (!isDirect && !isAuthorFollowed) continue;
    feed.push(post);
    if (feed.length >= 120) break;
  }

  return feed;
}

export function findPost(state, postId) {
  if (!postId) return null;
  const index = getPostIndex(state);
  return index.byId.get(postId) || null;
}

export function invalidatePostIndex(state) {
  if (!state) return;
  state.socialPostIndexVersion = (state.socialPostIndexVersion || 0) + 1;
  state.socialPostIndexCache = null;
  state.activityPubIndexCache = null;
}

export function extractMentions(content = '') {
  const handles = new Set();
  MENTION_REGEX.lastIndex = 0;
  let match;
  while ((match = MENTION_REGEX.exec(content))) {
    const handle = match[1].replace(/\.+$/, '').toLowerCase();
    if (handle.length >= 2) handles.add(handle);
  }
  return [...handles];
}

export function extractTags(content = '') {
  const tags = new Set();
  TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = TAG_REGEX.exec(content))) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags];
}

export function isDuplicateActivityPub(state, activityPub = {}) {
  const objectId = activityPub?.objectId;
  const activityId = activityPub?.activityId;
  if (!objectId && !activityId) return false;
  const index = getActivityPubIndex(state);
  if (objectId && index.byObjectId.has(objectId)) return true;
  if (activityId && index.byActivityId.has(activityId)) return true;
  return false;
}

export function buildActivityPubIndexSnapshot(state) {
  if (!state) return null;
  const posts = state.socialPosts || [];
  const index = getActivityPubIndex(state);
  const snapshot = buildActivityPubSnapshotFromIndex(index, posts);
  state.activityPubIndex = snapshot;
  return snapshot;
}

function getPostIndex(state) {
  if (!state?.socialPosts) return EMPTY_POST_INDEX;
  const version = state.socialPostIndexVersion || 0;
  const size = state.socialPosts.length || 0;
  const cached = state.socialPostIndexCache;
  if (cached && cached.version === version && cached.size === size) return cached;
  const byId = new Map();
  for (const post of state.socialPosts || []) {
    if (post?.id) byId.set(post.id, post);
  }
  const index = { byId, version, size };
  state.socialPostIndexCache = index;
  return index;
}

function getActivityPubIndex(state) {
  if (!state?.socialPosts) return EMPTY_ACTIVITYPUB_INDEX;
  const posts = state.socialPosts || [];
  const version = state.socialPostIndexVersion || 0;
  const size = posts.length || 0;
  const headId = resolveHeadId(posts);
  const tailId = resolveTailId(posts);
  const cached = state.activityPubIndexCache;
  if (cached && cached.version === version && cached.size === size && cached.headId === headId && cached.tailId === tailId) {
    return cached;
  }

  const snapshot = state.activityPubIndex;
  if (isActivityPubSnapshotValid(snapshot, posts)) {
    const { byObjectId, byActivityId } = buildActivityPubIndexFromSnapshot(snapshot);
    const index = { byObjectId, byActivityId, version, size, headId, tailId };
    state.activityPubIndexCache = index;
    return index;
  }

  const built = buildActivityPubIndexFromPosts(posts);
  const index = { byObjectId: built.byObjectId, byActivityId: built.byActivityId, version, size, headId, tailId };
  state.activityPubIndexCache = index;
  state.activityPubIndex = built.snapshot;
  return index;
}

function buildActivityPubIndexFromPosts(posts = []) {
  const byObjectId = new Map();
  const byActivityId = new Map();
  for (const post of posts || []) {
    const meta = post?.activityPub;
    if (!meta) continue;
    if (meta.objectId) byObjectId.set(meta.objectId, post.id || true);
    if (meta.activityId) byActivityId.set(meta.activityId, post.id || true);
  }
  const snapshot = buildActivityPubSnapshotFromIndex({ byObjectId, byActivityId }, posts);
  return { byObjectId, byActivityId, snapshot };
}

function buildActivityPubIndexFromSnapshot(snapshot = {}) {
  const byObjectId = new Map();
  const byActivityId = new Map();
  const objectIds = Array.isArray(snapshot.objectIds) ? snapshot.objectIds : [];
  const activityIds = Array.isArray(snapshot.activityIds) ? snapshot.activityIds : [];
  for (const objectId of objectIds) {
    if (objectId) byObjectId.set(objectId, true);
  }
  for (const activityId of activityIds) {
    if (activityId) byActivityId.set(activityId, true);
  }
  return { byObjectId, byActivityId };
}

function buildActivityPubSnapshotFromIndex(index, posts = []) {
  const size = posts.length || 0;
  return {
    objectIds: Array.from(index.byObjectId.keys()),
    activityIds: Array.from(index.byActivityId.keys()),
    size,
    headId: resolveHeadId(posts),
    tailId: resolveTailId(posts),
    updatedAt: new Date().toISOString(),
  };
}

function isActivityPubSnapshotValid(snapshot, posts = []) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (!Array.isArray(snapshot.objectIds) || !Array.isArray(snapshot.activityIds)) return false;
  const size = posts.length || 0;
  if ((snapshot.size || 0) !== size) return false;
  if ((snapshot.headId || '') !== resolveHeadId(posts)) return false;
  if ((snapshot.tailId || '') !== resolveTailId(posts)) return false;
  return true;
}

function resolveHeadId(posts) {
  return posts.length ? posts[0]?.id || '' : '';
}

function resolveTailId(posts) {
  return posts.length ? posts[posts.length - 1]?.id || '' : '';
}
