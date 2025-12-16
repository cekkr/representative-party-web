import { randomUUID } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';

export const DEFAULT_FOLLOW_TYPES = ['circle', 'friends', 'info', 'alerts', 'politics', 'engineers', 'work'];

export function normalizeFollowType(rawType = 'circle') {
  const cleaned = sanitizeText(rawType, 32).toLowerCase() || 'circle';
  if (DEFAULT_FOLLOW_TYPES.includes(cleaned)) return cleaned;
  return cleaned.replace(/[^a-z0-9_-]/g, '') || 'circle';
}

export function ensureFollowEdge(state, { followerHash, targetHash, targetHandle, type }) {
  const followType = normalizeFollowType(type);
  const filtered = (state.socialFollows || []).filter(
    (edge) => !(edge.followerHash === followerHash && edge.targetHash === targetHash),
  );

  const entry = {
    id: randomUUID(),
    followerHash,
    targetHash,
    targetHandle: targetHandle || '',
    type: followType,
    createdAt: new Date().toISOString(),
    validationStatus: 'validated',
  };

  state.socialFollows = [entry, ...filtered];
  return entry;
}

export function removeFollowEdge(state, { followerHash, targetHash }) {
  const before = state.socialFollows || [];
  const after = before.filter((edge) => !(edge.followerHash === followerHash && edge.targetHash === targetHash));
  state.socialFollows = after;
  return before.length !== after.length;
}

export function listFollowsFor(state, followerHash, typeFilter) {
  const normalizedType = typeFilter ? normalizeFollowType(typeFilter) : null;
  return (state.socialFollows || []).filter((edge) => {
    if (edge.followerHash !== followerHash) return false;
    if (normalizedType) return edge.type === normalizedType;
    return true;
  });
}

export function listFollowersOf(state, targetHash) {
  return (state.socialFollows || []).filter((edge) => edge.targetHash === targetHash);
}

export function findSessionByHandle(state, handle) {
  if (!handle) return null;
  const normalized = handle.trim().toLowerCase();
  for (const session of state.sessions.values()) {
    const sessionHandle = (session.handle || '').toLowerCase();
    if (sessionHandle === normalized) return session;
  }
  return null;
}
