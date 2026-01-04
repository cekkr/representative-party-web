const EMPTY_INDEX = { byHandle: new Map(), byHash: new Map(), version: 0, size: 0 };

export function invalidateSessionIndex(state) {
  if (!state) return;
  state.sessionIndexVersion = (state.sessionIndexVersion || 0) + 1;
  state.sessionIndexCache = null;
}

export function findSessionByHandle(state, handle) {
  if (!handle) return null;
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;
  const index = getSessionIndex(state);
  return index.byHandle.get(normalized) || null;
}

export function findSessionByHash(state, pidHash) {
  if (!pidHash) return null;
  const index = getSessionIndex(state);
  return index.byHash.get(pidHash) || null;
}

function getSessionIndex(state) {
  if (!state?.sessions) return EMPTY_INDEX;
  const version = state.sessionIndexVersion || 0;
  const size = state.sessions.size || 0;
  const cached = state.sessionIndexCache;
  if (cached && cached.version === version && cached.size === size) return cached;
  const byHandle = new Map();
  const byHash = new Map();
  for (const session of state.sessions.values()) {
    if (session?.handle) {
      const normalized = normalizeHandle(session.handle);
      if (normalized) byHandle.set(normalized, session);
    }
    if (session?.pidHash) {
      byHash.set(session.pidHash, session);
    }
  }
  const index = { byHandle, byHash, version, size };
  state.sessionIndexCache = index;
  return index;
}

function normalizeHandle(handle = '') {
  return String(handle).trim().replace(/^@+/, '').toLowerCase();
}
