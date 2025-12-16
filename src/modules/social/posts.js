import { randomUUID } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';
import { stampLocalEntry, filterVisibleEntries } from '../federation/replication.js';
import { listFollowsFor, normalizeFollowType } from './followGraph.js';

const MAX_POST_LENGTH = 560;

export function createPost(state, { citizen, content, replyTo = null, visibility = 'public', targetHash = '', targetHandle = '' }) {
  const body = sanitizeText(content, MAX_POST_LENGTH);
  if (!body) {
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

  const entry = stampLocalEntry(state, {
    id: randomUUID(),
    authorHash: citizen?.pidHash || 'anonymous',
    authorHandle: citizen?.handle || 'guest',
    content: body,
    createdAt: new Date().toISOString(),
    replyTo: replyTo || null,
    visibility: normalizedVisibility,
    targetHash: normalizedVisibility === 'direct' ? targetHash : '',
    targetHandle: normalizedVisibility === 'direct' ? targetHandle : '',
  });

  state.socialPosts = [entry, ...(state.socialPosts || [])];
  return entry;
}

export function buildFeed(state, citizen, { followType } = {}) {
  const allPosts = filterVisibleEntries(state.socialPosts || [], state);
  if (!citizen) {
    return allPosts.filter((post) => post.visibility !== 'direct').slice(0, 80);
  }

  const ownHash = citizen.pidHash;
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
