const PROVIDER_BLIND_MODES = new Set(['off', 'observe', 'strict']);
const AUDIT_ROLES = new Set(['member', 'provider', 'observer']);

const PROVIDER_BLIND_DEFAULTS = {
  mode: 'off',
  ring: {
    currentId: '',
    epochSeconds: 2_592_000,
    maxSize: 32,
    keys: [],
  },
  rings: [],
  audit: {
    threshold: 3,
    members: [],
    requireReason: true,
    maxScopeDays: 30,
    emergencyOverride: false,
    overrideComposition: false,
  },
  transport: {
    mixnetEnabled: false,
    relays: [],
    maxHops: 2,
    timeoutMs: 5000,
  },
};

export function getProviderBlindDefaults() {
  return structuredCloneSafe(PROVIDER_BLIND_DEFAULTS);
}

export function getProviderBlindSettings(state) {
  return normalizeProviderBlindSettings(state?.settings?.providerBlind || {});
}

export function normalizeProviderBlindSettings(raw = {}) {
  const defaults = getProviderBlindDefaults();
  const mode = normalizeMode(raw.mode, defaults.mode);
  const ringInput = raw.ring || {};
  const envRingId = resolveEnvRingId();
  const ringSeed = { ...ringInput };
  if (!ringSeed.currentId && !ringSeed.ringId && envRingId) {
    ringSeed.currentId = envRingId;
  }
  const ring = normalizeRing(ringSeed, defaults.ring);
  const rings = normalizeRingRegistry(raw.rings || raw.ringRegistry || [], { maxSize: ring.maxSize });
  const audit = normalizeAudit(raw.audit || {}, defaults.audit);
  const transport = normalizeTransport(raw.transport || {}, defaults.transport);

  return {
    mode,
    ring,
    rings,
    audit,
    transport,
  };
}

export function validateProviderBlindSettings(settings) {
  const errors = [];
  const normalized = normalizeProviderBlindSettings(settings || {});
  const mode = normalized.mode;
  const ringKeys = normalized.ring.keys || [];
  const ringSize = ringKeys.length;
  const auditMembers = normalized.audit.members || [];
  const threshold = Number(normalized.audit.threshold || 0);

  if (mode !== 'off') {
    if (!normalized.ring.currentId) {
      errors.push('Ring ID is required when provider-blind mode is enabled.');
    }
    if (ringSize < 3) {
      errors.push('Ring key list must include at least 3 provider keys.');
    }
  }

  if (ringSize && ringSize > normalized.ring.maxSize) {
    errors.push(`Ring size cannot exceed the cap (${normalized.ring.maxSize}).`);
  }

  if (auditMembers.length) {
    if (threshold < 2 || threshold > auditMembers.length) {
      errors.push('Audit threshold must be between 2 and the number of committee members.');
    }
    if (!normalized.audit.overrideComposition) {
      const composition = countAuditRoles(auditMembers);
      if (composition.member < 2 || composition.provider < 2 || composition.observer < 1) {
        errors.push('Audit committee must include 2 member seats, 2 provider seats, and 1 observer seat.');
      }
    }
  } else if (mode === 'strict') {
    errors.push('Audit committee members are required in strict provider-blind mode.');
  }

  return { errors, settings: normalized };
}

export function resolveRingKeys(providerBlind, ringId) {
  const normalized = normalizeProviderBlindSettings(providerBlind || {});
  if (!ringId || ringId === normalized.ring.currentId) {
    return normalized.ring.keys || [];
  }
  const registry = normalized.rings || [];
  const match = registry.find((entry) => entry.id === ringId);
  return match?.keys || [];
}

export function upsertRingRegistryEntry(providerBlind, entry) {
  const normalized = normalizeProviderBlindSettings(providerBlind || {});
  if (!entry || !entry.id) return normalized;
  const ringEntry = normalizeRingEntry(entry, { maxSize: normalized.ring.maxSize });
  const filtered = (normalized.rings || []).filter((item) => item.id !== ringEntry.id);
  return { ...normalized, rings: [ringEntry, ...filtered].slice(0, 24) };
}

export function buildProviderBlindAnnouncement(providerBlind) {
  const normalized = normalizeProviderBlindSettings(providerBlind || {});
  const ring = normalized.ring.currentId
    ? {
        id: normalized.ring.currentId,
        epochSeconds: normalized.ring.epochSeconds,
        maxSize: normalized.ring.maxSize,
        keys: normalized.ring.keys,
      }
    : null;
  const rings = (normalized.rings || []).map((entry) => ({
    id: entry.id,
    keys: entry.keys,
    createdAt: entry.createdAt || null,
    expiresAt: entry.expiresAt || null,
  }));
  const auditMembers = (normalized.audit.members || []).map((member) => ({
    keyId: member.keyId,
    role: member.role,
    termStart: member.termStart || null,
    termEnd: member.termEnd || null,
  }));
  const audit = auditMembers.length
    ? {
        threshold: normalized.audit.threshold,
        members: auditMembers,
      }
    : null;
  if (!ring && !rings.length && !audit) return null;
  return {
    mode: normalized.mode,
    ring,
    rings,
    audit,
  };
}

export function mergeProviderBlindAnnouncement(providerBlind, announcement) {
  const normalized = normalizeProviderBlindSettings(providerBlind || {});
  if (!announcement || typeof announcement !== 'object') {
    return { updated: false, settings: normalized };
  }

  let updated = false;
  let next = normalized;
  const ringEntries = [];
  if (announcement.ring && (announcement.ring.id || announcement.ring.currentId)) {
    ringEntries.push(announcement.ring);
  }
  if (Array.isArray(announcement.rings)) {
    ringEntries.push(...announcement.rings);
  }

  for (const entry of ringEntries) {
    const normalizedEntry = normalizeRingEntry(entry, { maxSize: next.ring.maxSize });
    if (!normalizedEntry.id || !normalizedEntry.keys.length) continue;
    const merged = upsertRingRegistryEntry(next, normalizedEntry);
    if (JSON.stringify(merged.rings) !== JSON.stringify(next.rings)) {
      updated = true;
      next = merged;
    }
    if (!next.ring.currentId) {
      next = { ...next, ring: { ...next.ring, currentId: normalizedEntry.id, keys: normalizedEntry.keys } };
      updated = true;
    } else if (next.ring.currentId === normalizedEntry.id && !next.ring.keys.length) {
      next = { ...next, ring: { ...next.ring, keys: normalizedEntry.keys } };
      updated = true;
    }
  }

  if (announcement.audit && Array.isArray(announcement.audit.members)) {
    const candidate = normalizeAudit(announcement.audit, next.audit);
    if (!next.audit.members.length && candidate.members.length) {
      next = { ...next, audit: { ...next.audit, members: candidate.members, threshold: candidate.threshold } };
      updated = true;
    }
  }

  return { updated, settings: next };
}

function normalizeMode(value, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return PROVIDER_BLIND_MODES.has(text) ? text : fallback;
}

function resolveEnvRingId() {
  return sanitizeToken(process.env.CIRCLE_RING_ID || '', 64);
}

function normalizeRing(raw = {}, fallback) {
  const currentId = sanitizeToken(raw.currentId || raw.ringId || fallback.currentId, 64);
  const epochSeconds = clampNumber(raw.epochSeconds ?? raw.epoch ?? fallback.epochSeconds, {
    fallback: fallback.epochSeconds,
    min: 86_400,
    max: 31_536_000,
  });
  const maxSize = clampNumber(raw.maxSize ?? fallback.maxSize, { fallback: fallback.maxSize, min: 3, max: 256 });
  const keys = normalizeKeyList(raw.keys ?? fallback.keys, { maxLen: 4096, maxItems: maxSize });
  return {
    currentId,
    epochSeconds,
    maxSize,
    keys,
  };
}

function normalizeRingRegistry(list, { maxSize }) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => normalizeRingEntry(entry, { maxSize }))
    .filter((entry) => entry.id && entry.keys.length)
    .slice(0, 24);
}

function normalizeRingEntry(entry, { maxSize }) {
  const id = sanitizeToken(entry?.id || entry?.ringId || '', 64);
  const createdAt = sanitizeToken(entry?.createdAt || '', 32);
  const expiresAt = sanitizeToken(entry?.expiresAt || '', 32);
  const keys = normalizeKeyList(entry?.keys || [], { maxLen: 4096, maxItems: maxSize });
  return { id, keys, createdAt, expiresAt };
}

function normalizeAudit(raw = {}, fallback) {
  const threshold = clampNumber(raw.threshold ?? fallback.threshold, {
    fallback: fallback.threshold,
    min: 2,
    max: 25,
  });
  const members = normalizeAuditMembers(raw.members ?? fallback.members, { maxLen: 120, maxItems: 25 });
  const requireReason = normalizeBoolean(raw.requireReason, fallback.requireReason);
  const maxScopeDays = clampNumber(raw.maxScopeDays ?? fallback.maxScopeDays, {
    fallback: fallback.maxScopeDays,
    min: 1,
    max: 365,
  });
  const emergencyOverride = normalizeBoolean(raw.emergencyOverride, fallback.emergencyOverride);
  const overrideComposition = normalizeBoolean(raw.overrideComposition, fallback.overrideComposition);
  return {
    threshold,
    members,
    requireReason,
    maxScopeDays,
    emergencyOverride,
    overrideComposition,
  };
}

function normalizeAuditMembers(list, { maxLen, maxItems } = {}) {
  if (!Array.isArray(list)) return [];
  const members = [];
  for (const entry of list) {
    if (!entry) continue;
    const keyId = sanitizeToken(entry.keyId || '', maxLen);
    const role = sanitizeToken(entry.role || '', 24).toLowerCase();
    if (!keyId || !AUDIT_ROLES.has(role)) continue;
    const termStart = sanitizeToken(entry.termStart || '', 32);
    const termEnd = sanitizeToken(entry.termEnd || '', 32);
    members.push({ keyId, role, termStart, termEnd });
    if (maxItems && members.length >= maxItems) break;
  }
  return dedupeByKey(members, 'keyId');
}

function normalizeTransport(raw = {}, fallback) {
  const mixnetEnabled = normalizeBoolean(raw.mixnetEnabled, fallback.mixnetEnabled);
  const relays = normalizeKeyList(raw.relays ?? fallback.relays, { maxLen: 200, maxItems: 20 });
  const maxHops = clampNumber(raw.maxHops ?? fallback.maxHops, { fallback: fallback.maxHops, min: 1, max: 5 });
  const timeoutMs = clampNumber(raw.timeoutMs ?? fallback.timeoutMs, { fallback: fallback.timeoutMs, min: 1000, max: 30_000 });
  return {
    mixnetEnabled,
    relays,
    maxHops,
    timeoutMs,
  };
}

function normalizeKeyList(value, { maxLen = 120, maxItems = 50 } = {}) {
  const entries = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const cleaned = entries
    .map((entry) => sanitizeToken(entry, maxLen))
    .filter(Boolean);
  return dedupe(cleaned).slice(0, maxItems);
}

function countAuditRoles(list) {
  return list.reduce(
    (acc, entry) => {
      if (!entry || !AUDIT_ROLES.has(entry.role)) return acc;
      acc[entry.role] += 1;
      return acc;
    },
    { member: 0, provider: 0, observer: 0 },
  );
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return Boolean(fallback);
}

function clampNumber(value, { fallback, min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (Number.isFinite(min) && parsed < min) return min;
  if (Number.isFinite(max) && parsed > max) return max;
  return parsed;
}

function sanitizeToken(value, maxLen) {
  const text = typeof value === 'string' ? value.trim() : '';
  return maxLen ? text.slice(0, maxLen) : text;
}

function dedupe(list = []) {
  return [...new Set(list)];
}

function dedupeByKey(list = [], key) {
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    const value = entry?.[key];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(entry);
  }
  return result;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
