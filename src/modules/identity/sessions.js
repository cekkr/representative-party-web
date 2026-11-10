const EMPTY_INDEX = { byHandle: new Map(), byHash: new Map(), sessionsByHash: new Map(), bannedHashes: new Set(), version: 0, size: 0 };

// A handle, a role, and a ban belong to the verified identity (the blinded pid
// hash), not to one browser session. A member who verifies again on a second
// device gets a new session; without this rule that session started with a
// synthesized handle, the default role, and no ban, so the member's @handle
// vanished from every label and a banned member could verify their way out of
// the ban. Writes go through `applyIdentityStanding`, new sessions inherit
// through `resolveIdentityStanding`, and ban checks read `isIdentityBanned`.

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

// The session that represents an identity: the most recently verified one that
// carries a chosen handle, else the most recently verified.
export function findSessionByHash(state, pidHash) {
  if (!pidHash) return null;
  const index = getSessionIndex(state);
  return index.byHash.get(pidHash) || null;
}

export function listSessionsForHash(state, pidHash) {
  if (!pidHash) return [];
  return [...(getSessionIndex(state).sessionsByHash.get(pidHash) || [])];
}

export function isIdentityBanned(state, pidHash) {
  if (!pidHash) return false;
  return getSessionIndex(state).bannedHashes.has(pidHash);
}

// A handle the member chose, as opposed to the `person-<hash>` fallback written at
// verification. Compared against this identity's own fallback because test and
// seed hashes are not always hex.
export function isChosenHandle(handle, pidHash = '') {
  const value = String(handle || '').trim().replace(/^@+/, '');
  if (!value || SYNTHESIZED_HANDLE_PATTERN.test(value)) return false;
  const short = String(pidHash || '').slice(0, 8).toLowerCase();
  return !(short && ['user', 'person'].some((prefix) => value.toLowerCase() === `${prefix}-${short}`));
}

// What a new session for this identity inherits from the verified sessions it
// already has: the newest chosen handle, the newest role, and any ban.
export function resolveIdentityStanding(state, pidHash, { excludeSessionId = null } = {}) {
  const sessions = listSessionsForHash(state, pidHash)
    .filter((session) => session.status === 'verified' && session.id !== excludeSessionId);
  if (!sessions.length) return { known: false, handle: '', role: '', banned: false };
  return {
    known: true,
    handle: sessions.find((session) => isChosenHandle(session.handle, pidHash))?.handle || '',
    role: sessions[0].role || '',
    banned: sessions.some((session) => session.banned),
  };
}

// Write identity-level fields to every session of a verified identity. Returns
// how many sessions changed.
export function applyIdentityStanding(state, pidHash, fields = {}) {
  if (!pidHash || !state?.sessions) return 0;
  const patch = {};
  for (const key of ['handle', 'role', 'banned']) {
    if (Object.hasOwn(fields, key)) patch[key] = key === 'banned' ? Boolean(fields[key]) : fields[key];
  }
  let changed = 0;
  for (const [id, session] of state.sessions.entries()) {
    if (session?.pidHash !== pidHash) continue;
    state.sessions.set(id, { ...session, ...patch });
    changed += 1;
  }
  if (changed) invalidateSessionIndex(state);
  return changed;
}

function verifiedTime(session) {
  const value = session?.verifiedAt;
  if (Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getSessionIndex(state) {
  if (!state?.sessions) return EMPTY_INDEX;
  const version = state.sessionIndexVersion || 0;
  const size = state.sessions.size || 0;
  const cached = state.sessionIndexCache;
  if (cached && cached.version === version && cached.size === size) return cached;
  const byHandle = new Map();
  const sessionsByHash = new Map();
  const bannedHashes = new Set();
  for (const [id, entry] of state.sessions.entries()) {
    if (!entry) continue;
    const session = entry.id ? entry : { ...entry, id };
    if (session.handle) {
      const normalized = normalizeHandle(session.handle);
      if (normalized) byHandle.set(normalized, session);
    }
    if (session.pidHash) {
      const list = sessionsByHash.get(session.pidHash) || [];
      list.push(session);
      sessionsByHash.set(session.pidHash, list);
      if (session.banned) bannedHashes.add(session.pidHash);
    }
  }
  const byHash = new Map();
  for (const [hash, list] of sessionsByHash) {
    // Newest first; a stable sort keeps insertion order between equal times.
    list.sort((a, b) => verifiedTime(b) - verifiedTime(a));
    byHash.set(hash, list.find((session) => isChosenHandle(session.handle, hash)) || list[0]);
  }
  const index = { byHandle, byHash, sessionsByHash, bannedHashes, version, size };
  state.sessionIndexCache = index;
  return index;
}

function normalizeHandle(handle = '') {
  return String(handle).trim().replace(/^@+/, '').toLowerCase();
}

// Handles must start and end with an alphanumeric and may carry dots, dashes, and
// underscores in between. Dots let a civic Circle use natural firstname.lastname handles
// (e.g. @giulia.ferrero) while the leading/trailing guard keeps them URL- and label-safe.
const HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SYNTHESIZED_HANDLE_PATTERN = /^(user|person)-[0-9a-f]{1,8}$/i;
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

// Validate and normalize a user-chosen handle: enforce a safe charset/length, block
// impersonation of synthesized fallback handles, and ensure uniqueness across sessions.
export function validateHandleChoice(state, rawHandle, { sessionId, pidHash = null } = {}) {
  const handle = String(rawHandle || '').trim().replace(/^@+/, '');
  if (!handle) {
    return { ok: false, error: 'Handle is required.' };
  }
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
    return { ok: false, error: `Handle must be ${HANDLE_MIN_LENGTH}-${HANDLE_MAX_LENGTH} characters.` };
  }
  if (!HANDLE_PATTERN.test(handle) || handle.includes('..')) {
    return { ok: false, error: 'Handle may only contain letters, numbers, dashes, underscores, and dots (not at the ends).' };
  }
  if (SYNTHESIZED_HANDLE_PATTERN.test(handle)) {
    return { ok: false, error: 'That handle pattern is reserved for auto-generated identifiers.' };
  }
  const existing = findSessionByHandle(state, handle);
  // Another session of the same verified identity may already hold it.
  if (existing && existing.id !== sessionId && !(pidHash && existing.pidHash === pidHash)) {
    return { ok: false, error: 'That handle is already taken.' };
  }
  return { ok: true, handle };
}
