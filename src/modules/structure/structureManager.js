import { sanitizeText } from '../../shared/utils/text.js';

export const CANONICAL_PROFILE_FIELDS = [
  { key: 'handle', label: 'Handle', type: 'string', required: true, scope: 'canonical' },
  { key: 'credentialBinding', label: 'Credential/wallet binding', type: 'string', required: true, scope: 'canonical' },
  { key: 'blindedHash', label: 'Blinded identity hash', type: 'string', required: true, scope: 'canonical' },
  { key: 'role', label: 'Role', type: 'string', required: true, scope: 'canonical' },
  { key: 'banned', label: 'Banned flag', type: 'boolean', required: true, scope: 'canonical' },
];

const CANONICAL_KEYS = new Set(CANONICAL_PROFILE_FIELDS.map((field) => field.key));
const ALLOWED_TYPES = ['string', 'email', 'boolean', 'number'];

export function buildProfileSchema(providerFields = []) {
  const normalized = normalizeProviderFields(providerFields);
  return [...CANONICAL_PROFILE_FIELDS, ...normalized];
}

export function normalizeProviderFields(fields = []) {
  return (fields || [])
    .map((field, index) => normalizeProviderField(field, index))
    .filter(Boolean);
}

export function formatProviderFieldsForTextarea(fields = []) {
  return (fields || [])
    .map((field) => `${field.key}${field.required ? '!' : ''}:${field.type}:${field.label}`)
    .join('\n');
}

export function parseProviderFieldInput(raw, fallback = []) {
  if (raw === undefined || raw === null) return normalizeProviderFields(fallback);
  const text = String(raw).trim();
  if (!text) return [];
  const parsedJson = tryParseJson(text);
  if (Array.isArray(parsedJson)) {
    return normalizeProviderFields(parsedJson);
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const draftFields = lines
    .map((line, idx) => {
      const parts = line.split(':').map((part) => part.trim());
      if (!parts.length) return null;
      const [keyPart, typePart, ...labelParts] = parts;
      const labelPart = labelParts.join(':');
      const required = keyPart.endsWith('!') || keyPart.endsWith('*') || typePart === 'required';
      const cleanKey = keyPart.replace(/[!*]$/, '');
      return {
        key: cleanKey,
        type: typePart === 'required' ? 'string' : typePart || 'string',
        label: labelPart || cleanKey,
        required,
      };
    })
    .filter(Boolean);
  return normalizeProviderFields(draftFields);
}

export function parseAttributePayload(raw, providerSchema = []) {
  const source = normalizeAttributeSource(raw);
  if (!source) return {};
  const providerIndex = indexProviderSchema(providerSchema);
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = sanitizeKey(rawKey);
    const field = providerIndex.get(key);
    if (!field) continue;
    const value = coerceValueForField(rawValue, field);
    if (value === undefined) continue;
    output[key] = value;
  }
  return output;
}

export function upsertProviderAttributes(state, { sessionId, handle, attributes = {}, replace = false }) {
  if (!sessionId || !state) return null;
  if (!state.profileAttributes) {
    state.profileAttributes = [];
  }
  const now = new Date().toISOString();
  const existingIndex = state.profileAttributes.findIndex((entry) => entry.sessionId === sessionId);
  const existing = existingIndex >= 0 ? state.profileAttributes[existingIndex] : null;
  const providerPayload = replace ? { ...attributes } : { ...(existing?.provider || {}), ...attributes };
  const next = {
    sessionId,
    handle: handle || existing?.handle || '',
    provider: providerPayload,
    updatedAt: now,
  };
  if (existingIndex >= 0) {
    state.profileAttributes[existingIndex] = next;
  } else {
    state.profileAttributes.push(next);
  }
  return next;
}

export function describeCanonicalProfile() {
  return CANONICAL_PROFILE_FIELDS.map((field) => `${field.key} (${field.type}${field.required ? ', required' : ''})`).join(', ');
}

function normalizeProviderField(field = {}, index = 0) {
  const rawKey = field.key || field.name || `field_${index + 1}`;
  const key = sanitizeKey(rawKey);
  if (!key || CANONICAL_KEYS.has(key)) return null;
  const label = sanitizeText(field.label || field.name || key, 80) || key;
  return {
    key,
    label,
    description: sanitizeText(field.description || '', 160),
    type: normalizeType(field.type),
    required: Boolean(field.required) || String(rawKey).endsWith('!'),
    scope: 'provider',
  };
}

function normalizeType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'string';
  if (ALLOWED_TYPES.includes(normalized)) return normalized;
  if (normalized === 'numeric' || normalized === 'number') return 'number';
  return 'string';
}

function sanitizeKey(value) {
  const text = sanitizeText(value || '', 48).toLowerCase();
  return text.replace(/[^a-z0-9_-]/g, '');
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function normalizeAttributeSource(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return null;
  const parsedJson = tryParseJson(text);
  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    return parsedJson;
  }
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const result = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf('=');
    const altIndex = line.indexOf(':');
    const idx = separatorIndex >= 0 ? separatorIndex : altIndex;
    if (idx <= 0) continue;
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (!key) continue;
    result[key] = value;
  }
  return result;
}

function coerceValueForField(rawValue, field) {
  if (field.type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    const text = String(rawValue).toLowerCase();
    if (!text) return undefined;
    if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true;
    if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false;
    return undefined;
  }
  if (field.type === 'number') {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const textValue = sanitizeText(String(rawValue || ''), 240);
  if (!textValue) return undefined;
  if (field.type === 'email') {
    return textValue.toLowerCase();
  }
  return textValue;
}

function indexProviderSchema(schema = []) {
  const map = new Map();
  for (const field of schema) {
    if (field.scope !== 'provider') continue;
    const key = sanitizeKey(field.key);
    if (!key) continue;
    map.set(key, field);
  }
  return map;
}
