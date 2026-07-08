import { POLICIES } from '../../config.js';
import { normalizeModuleSettings, resolveModuleSettings } from '../circle/modules.js';
import { resolvePeerKey } from './quarantine.js';
import { getReplicationProfile } from './replication.js';

const MAX_PEER_CAPABILITIES = 80;

export function buildCapabilitiesSnapshot(state) {
  return {
    modules: resolveModuleSettings(state),
    replication: getReplicationProfile(state),
  };
}

export function listPeerCapabilities(state) {
  const peerCapabilities = state?.settings?.peerCapabilities || {};
  const maxAgeMs = resolveMaxAgeMs();
  if (!maxAgeMs) return peerCapabilities;
  const fresh = {};
  for (const [key, entry] of Object.entries(peerCapabilities)) {
    if (!isStale(entry?.observedAt)) {
      fresh[key] = entry;
    }
  }
  return fresh;
}

export function getPeerCapabilities(state, peerKey) {
  const key = resolvePeerKey(peerKey);
  if (!key) return null;
  const entry = state?.settings?.peerCapabilities?.[key];
  if (!entry) return null;
  if (isStale(entry.observedAt)) return null;
  return entry;
}

export function recordPeerCapabilities(state, peerKey, snapshot, { now = new Date() } = {}) {
  const key = resolvePeerKey(peerKey);
  if (!key || !snapshot) return { updated: false };
  const normalized = normalizePeerCapabilities(snapshot);
  if (!normalized) return { updated: false };

  if (!state.settings) state.settings = {};
  if (!state.settings.peerCapabilities) state.settings.peerCapabilities = {};
  const current = state.settings.peerCapabilities[key];
  const next = { ...normalized, observedAt: now.toISOString() };
  if (current && isSameCapabilities(current, next)) {
    return { updated: false, entry: current };
  }

  state.settings.peerCapabilities[key] = next;
  prunePeerCapabilities(state.settings.peerCapabilities);
  return { updated: true, entry: next };
}

function normalizePeerCapabilities(snapshot = {}) {
  const modules = snapshot.modules ? normalizeModuleSettings(snapshot.modules) : null;
  const replication = normalizeReplicationSnapshot(snapshot.replication);
  const policy = normalizePolicySnapshot(snapshot.policy);
  const issuer = sanitizeToken(snapshot.issuer || '', 200);
  const ringId = sanitizeToken(snapshot.ringId || '', 64);

  if (!modules && !replication && !policy && !issuer && !ringId) return null;
  const fingerprint = buildCapabilitiesFingerprint({ modules, replication, policy, issuer, ringId });
  return {
    modules: modules || undefined,
    replication: replication || undefined,
    policy: policy || undefined,
    issuer: issuer || undefined,
    ringId: ringId || undefined,
    fingerprint: fingerprint || undefined,
  };
}

function normalizeReplicationSnapshot(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const mode = normalizeToken(raw.mode, { allowEmpty: true });
  const adapter = normalizeToken(raw.adapter, { allowEmpty: true });
  const validationLevel = normalizeToken(raw.validationLevel, { allowEmpty: true });
  const allowPreviews = typeof raw.allowPreviews === 'boolean' ? raw.allowPreviews : undefined;
  if (!mode && !adapter && !validationLevel && allowPreviews === undefined) return null;
  return {
    mode: mode || undefined,
    adapter: adapter || undefined,
    validationLevel: validationLevel || undefined,
    allowPreviews,
  };
}

function normalizePolicySnapshot(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = sanitizeToken(raw.id || '', 120);
  if (!id) return null;
  const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0;
  return { id, version };
}

function isSameCapabilities(existing, incoming) {
  if (!existing || !incoming) return false;
  if (existing.fingerprint && incoming.fingerprint) {
    return existing.fingerprint === incoming.fingerprint;
  }
  const a = JSON.stringify({
    modules: existing.modules || null,
    replication: existing.replication || null,
    policy: existing.policy || null,
    issuer: existing.issuer || null,
    ringId: existing.ringId || null,
  });
  const b = JSON.stringify({
    modules: incoming.modules || null,
    replication: incoming.replication || null,
    policy: incoming.policy || null,
    issuer: incoming.issuer || null,
    ringId: incoming.ringId || null,
  });
  return a === b;
}

function prunePeerCapabilities(peerCapabilities = {}) {
  const maxAgeMs = resolveMaxAgeMs();
  const entries = Object.entries(peerCapabilities);
  if (!entries.length) return;
  const now = Date.now();
  const fresh = entries.filter(([, entry]) => {
    if (!maxAgeMs) return true;
    const observedAt = Date.parse(entry?.observedAt || '');
    if (Number.isNaN(observedAt)) return true;
    return now - observedAt <= maxAgeMs;
  });
  fresh.sort((a, b) => {
    const aTime = Date.parse(a[1]?.observedAt || '') || 0;
    const bTime = Date.parse(b[1]?.observedAt || '') || 0;
    return bTime - aTime;
  });
  const trimmed = fresh.slice(0, MAX_PEER_CAPABILITIES);
  const next = {};
  for (const [key, value] of trimmed) {
    next[key] = value;
  }
  for (const key of Object.keys(peerCapabilities)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      delete peerCapabilities[key];
    }
  }
  for (const [key, value] of Object.entries(next)) {
    peerCapabilities[key] = value;
  }
}

function isStale(observedAt) {
  const maxAgeMs = resolveMaxAgeMs();
  if (!maxAgeMs) return false;
  const timestamp = Date.parse(observedAt || '');
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp > maxAgeMs;
}

function resolveMaxAgeMs() {
  const hours = Number(POLICIES.gossipPeerCapabilitiesMaxAgeHours);
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return hours * 60 * 60 * 1000;
}

function normalizeToken(value, { allowEmpty = false } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return allowEmpty ? '' : null;
  return text.slice(0, 64);
}

function sanitizeToken(value, maxLen) {
  const text = typeof value === 'string' ? value.trim() : '';
  return maxLen ? text.slice(0, maxLen) : text;
}

function buildCapabilitiesFingerprint({ modules, replication, policy, issuer, ringId } = {}) {
  const parts = [];
  if (modules && typeof modules === 'object') {
    const keys = Object.keys(modules).sort();
    const moduleParts = keys.map((key) => `${key}:${modules[key] === false ? '0' : '1'}`);
    parts.push(`modules:${moduleParts.join(',')}`);
  }
  if (replication && typeof replication === 'object') {
    const repParts = [];
    if (replication.mode) repParts.push(`mode=${replication.mode}`);
    if (replication.adapter) repParts.push(`adapter=${replication.adapter}`);
    if (replication.validationLevel) repParts.push(`validation=${replication.validationLevel}`);
    if (typeof replication.allowPreviews === 'boolean') {
      repParts.push(`previews=${replication.allowPreviews ? '1' : '0'}`);
    }
    if (repParts.length) parts.push(`replication:${repParts.join(',')}`);
  }
  if (policy && typeof policy === 'object' && policy.id) {
    const version = Number.isFinite(Number(policy.version)) ? Number(policy.version) : 0;
    parts.push(`policy:${policy.id}@${version}`);
  }
  if (ringId) parts.push(`ring:${ringId}`);
  if (issuer) parts.push(`issuer:${issuer}`);
  return parts.join('|');
}
