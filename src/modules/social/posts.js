import { randomUUID } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';
import { stampLocalEntry, filterVisibleEntries } from '../federation/replication.js';
import { createSocialNote, wrapCreateActivity } from '../federation/activitypub.js';
import { listFollowsFor, normalizeFollowType } from './followGraph.js';

const MAX_POST_LENGTH = 560;
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
  },
) {
  const body = sanitizeText(content, MAX_POST_LENGTH);
  const wantsReshare = Boolean(reshareOf);
  if (replyTo && wantsReshare) {
    const error = new Error('conflicting_intent');
    error.code = 'conflicting_intent';
    throw error;
  }
  if (!body && !wantsReshare) {
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
    };
  }

  const mentions = extractMentions(body);
  const tags = extractTags(body);
  const entry = stampLocalEntry(state, {
    id: randomUUID(),
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
    policyId: state?.settings?.policyId || 'party-circle-alpha',
    policyVersion: state?.settings?.policyVersion || 1,
  });

  const note = createSocialNote({ post: entry, baseUrl });
  const activity = wrapCreateActivity({ note, baseUrl });
  entry.activityPub = { note, activity };

  state.socialPosts = [entry, ...(state.socialPosts || [])];
  return entry;
}

export function buildFeed(state, person, { followType } = {}) {
  const allPosts = filterVisibleEntries(state.socialPosts || [], state);
  if (!person) {
    return allPosts.filter((post) => post.visibility !== 'direct').slice(0, 80);
  }

  const ownHash = person.pidHash;
  const normalizedType = followType ? normalizeFollowType(followType) : null;
  const follows = listFollowsFor(state, ownHash, normalizedType || undefined);
  const followedHashes = new Set(follows.map((edge) => edge.targetHash));
  followedHashes.add(ownHash);

  const allowedTypes = normalizedType ? new Set([normalizedType]) : null;

  const feed = [];
  for (const post of allPosts) {
    const isAuthorFollowed = followedHashes.has(post.authorHash);
    const isDirect = post.visibility === 'direct';
    const isRecipient = post.targetHash && post.targetHash === ownHash;
    if (isDirect && !(post.authorHash === ownHash || isRecipient)) continue;
    if (!isDirect && !isAuthorFollowed) continue;
    if (allowedTypes) {
      const edge = follows.find((f) => f.targetHash === post.authorHash);
      if (edge && !allowedTypes.has(edge.type)) continue;
    }
    feed.push(post);
    if (feed.length >= 120) break;
  }

  return feed;
}

export function findPost(state, postId) {
  return (state.socialPosts || []).find((post) => post.id === postId);
}

export function extractMentions(content = '') {
  const handles = new Set();
  MENTION_REGEX.lastIndex = 0;
  let match;
  while ((match = MENTION_REGEX.exec(content))) {
    handles.add(match[1].toLowerCase());
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
