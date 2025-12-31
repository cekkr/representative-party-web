import { normalizePeerUrl } from './peers.js';

const DEFAULT_THRESHOLD = -3;
const DEFAULT_QUARANTINE_MS = 6 * 60 * 60 * 1000;
const MAX_SCORE = 5;

export function resolvePeerKey(peerHint, issuer) {
  const candidate = peerHint || issuer;
  if (!candidate) return null;
  const url = normalizePeerUrl(candidate);
  if (url) return url;
  const trimmed = String(candidate).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

export function isPeerQuarantined(state, peerKey, now = Date.now()) {
  const key = resolvePeerKey(peerKey);
  if (!key) return { quarantined: false, updated: false };
  const entry = readPeerEntry(state, key);
  if (!entry || !entry.quarantineUntil) return { quarantined: false, updated: false };
  const until = Date.parse(entry.quarantineUntil);
  if (Number.isNaN(until)) return { quarantined: false, updated: false };
  if (now < until) return { quarantined: true, updated: false, entry };
  const next = { ...entry, quarantineUntil: null, quarantinedAt: null };
  const updated = writePeerEntry(state, key, next);
  return { quarantined: false, updated, entry: next };
}

export function recordPeerFailure(
  state,
  peerKey,
  { reason = 'unknown', penalty = 1, now = Date.now() } = {},
) {
  const key = resolvePeerKey(peerKey);
  if (!key) return { updated: false };
  const entry = normalizePeerEntry(readPeerEntry(state, key));
  const nextScore = Math.max(entry.score - penalty, -10);
  const next = {
    ...entry,
    score: nextScore,
    strikes: entry.strikes + 1,
    lastFailureAt: new Date(now).toISOString(),
    lastFailureReason: reason,
  };
  if (nextScore <= DEFAULT_THRESHOLD) {
    next.quarantinedAt = new Date(now).toISOString();
    next.quarantineUntil = new Date(now + DEFAULT_QUARANTINE_MS).toISOString();
  }
  const updated = writePeerEntry(state, key, next);
  return { updated, entry: next };
}

export function recordPeerSuccess(state, peerKey, { now = Date.now() } = {}) {
  const key = resolvePeerKey(peerKey);
  if (!key) return { updated: false };
  const entry = normalizePeerEntry(readPeerEntry(state, key));
  const nextScore = Math.min(entry.score + 1, MAX_SCORE);
  const next = {
    ...entry,
    score: nextScore,
    successes: entry.successes + 1,
    lastSuccessAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    quarantineUntil: null,
    quarantinedAt: null,
  };
  const updated = writePeerEntry(state, key, next);
  return { updated, entry: next };
}

export function listPeerHealth(state) {
  return state?.settings?.peerHealth || {};
}

export function resetPeerHealth(state, peerKey) {
  if (!state?.settings?.peerHealth) return { updated: false };
  const key = resolvePeerKey(peerKey);
  if (!key) return { updated: false };
  if (!Object.prototype.hasOwnProperty.call(state.settings.peerHealth, key)) {
    return { updated: false };
  }
  const next = { ...state.settings.peerHealth };
  delete next[key];
  state.settings.peerHealth = next;
  return { updated: true, removed: key };
}

export function clearPeerHealth(state) {
  if (!state?.settings?.peerHealth) return { updated: false, removed: [] };
  const keys = Object.keys(state.settings.peerHealth);
  if (!keys.length) return { updated: false, removed: [] };
  state.settings.peerHealth = {};
  return { updated: true, removed: keys };
}

export function summarizePeerHealth(peerHealth = {}, { limit = 20, now = Date.now() } = {}) {
  const entries = Object.entries(peerHealth || {}).map(([peer, entry]) => {
    const score = Number(entry.score) || 0;
    const quarantineUntil = entry.quarantineUntil || null;
    const quarantined = quarantineUntil ? Date.parse(quarantineUntil) > now : false;
    return {
      peer,
      score,
      quarantined,
      quarantineUntil,
      strikes: Number(entry.strikes) || 0,
      successes: Number(entry.successes) || 0,
      lastFailureAt: entry.lastFailureAt || null,
      lastFailureReason: entry.lastFailureReason || null,
      lastSuccessAt: entry.lastSuccessAt || null,
    };
  });
  const quarantinedCount = entries.filter((entry) => entry.quarantined).length;
  const worstScore = entries.length ? Math.min(...entries.map((entry) => entry.score)) : 0;
  entries.sort((a, b) => a.score - b.score || a.peer.localeCompare(b.peer));
  return {
    total: entries.length,
    quarantined: quarantinedCount,
    worstScore,
    entries: entries.slice(0, limit),
  };
}

function normalizePeerEntry(entry) {
  if (!entry) {
    return {
      score: 0,
      strikes: 0,
      successes: 0,
      lastFailureAt: null,
      lastFailureReason: null,
      lastSuccessAt: null,
      lastSeenAt: null,
      quarantinedAt: null,
      quarantineUntil: null,
    };
  }
  return {
    score: Number(entry.score) || 0,
    strikes: Number(entry.strikes) || 0,
    successes: Number(entry.successes) || 0,
    lastFailureAt: entry.lastFailureAt || null,
    lastFailureReason: entry.lastFailureReason || null,
    lastSuccessAt: entry.lastSuccessAt || null,
    lastSeenAt: entry.lastSeenAt || null,
    quarantinedAt: entry.quarantinedAt || null,
    quarantineUntil: entry.quarantineUntil || null,
  };
}

function readPeerEntry(state, key) {
  return state?.settings?.peerHealth ? state.settings.peerHealth[key] : null;
}

function writePeerEntry(state, key, entry) {
  if (!state.settings) state.settings = {};
  if (!state.settings.peerHealth) state.settings.peerHealth = {};
  const prev = state.settings.peerHealth[key];
  state.settings.peerHealth[key] = entry;
  return prev !== entry;
}
