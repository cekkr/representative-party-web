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

const HANDLE_PATTERN = /^[A-Za-z0-9_-]+$/;
const SYNTHESIZED_HANDLE_PATTERN = /^(user|person)-[0-9a-f]{1,8}$/i;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

// Validate and normalize a user-chosen handle: enforce a safe charset/length, block
// impersonation of synthesized fallback handles, and ensure uniqueness across sessions.
export function validateHandleChoice(state, rawHandle, { sessionId } = {}) {
  const handle = String(rawHandle || '').trim().replace(/^@+/, '');
  if (!handle) {
    return { ok: false, error: 'Handle is required.' };
  }
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
    return { ok: false, error: `Handle must be ${HANDLE_MIN_LENGTH}-${HANDLE_MAX_LENGTH} characters.` };
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return { ok: false, error: 'Handle may only contain letters, numbers, dashes, and underscores.' };
  }
  if (SYNTHESIZED_HANDLE_PATTERN.test(handle)) {
    return { ok: false, error: 'That handle pattern is reserved for auto-generated identifiers.' };
  }
  const existing = findSessionByHandle(state, handle);
  if (existing && existing.id !== sessionId) {
    return { ok: false, error: 'That handle is already taken.' };
  }
  return { ok: true, handle };
}
