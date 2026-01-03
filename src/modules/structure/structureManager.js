import { sanitizeText } from '../../shared/utils/text.js';

export const CANONICAL_PROFILE_FIELDS = [
  { key: 'handle', label: 'Handle', type: 'string', required: true, scope: 'canonical' },
  { key: 'credentialBinding', label: 'Credential/wallet binding', type: 'string', required: true, scope: 'canonical' },
  { key: 'blindedHash', label: 'Blinded identity hash', type: 'string', required: true, scope: 'canonical' },
  { key: 'role', label: 'Role', type: 'string', required: true, scope: 'canonical' },
  { key: 'banned', label: 'Banned flag', type: 'boolean', required: true, scope: 'canonical' },
];

const CANONICAL_KEYS = new Set(CANONICAL_PROFILE_FIELDS.map((field) => field.key));
const ALLOWED_TYPES = ['string', 'email', 'boolean', 'number', 'phone'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_REGEX = /^\+?[0-9().\-\s]{7,20}$/;

export function buildProfileSchema(providerFields = []) {
  const normalized = normalizeProviderFields(providerFields);
  return [...CANONICAL_PROFILE_FIELDS, ...normalized];
}

export function normalizeProviderFields(fields = []) {
  const seen = new Set();
  const normalized = [];
  for (const [index, field] of (fields || []).entries()) {
    const candidate = normalizeProviderField(field, index);
    if (!candidate) continue;
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    normalized.push(candidate);
  }
  return normalized;
}

export function formatProviderFieldsForTextarea(fields = []) {
  return (fields || [])
    .map((field) => `${field.key}${field.required ? '!' : ''}:${field.type}:${field.label}`)
    .join('\n');
}

export function parseProviderFieldInput(raw, fallback = []) {
  if (raw === undefined || raw === null) {
    return { fields: normalizeProviderFields(fallback), errors: [] };
  }
  const text = String(raw).trim();
  if (!text) return { fields: [], errors: [] };
  const parsedJson = tryParseJson(text);
  if (Array.isArray(parsedJson)) {
    const { fields, errors } = validateProviderFields(parsedJson);
    return { fields, errors };
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
  const { fields, errors } = validateProviderFields(draftFields);
  return { fields, errors };
}

export function parseAttributePayload(raw, providerSchema = []) {
  const { attributes } = parseAttributePayloadWithValidation(raw, providerSchema);
  return attributes;
}

export function parseAttributePayloadWithValidation(raw, providerSchema = []) {
  const source = normalizeAttributeSource(raw);
  if (!source) return { attributes: {}, errors: [] };
  const providerIndex = indexProviderSchema(providerSchema);
  const output = {};
  const errors = [];
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = sanitizeKey(rawKey);
    const field = providerIndex.get(key);
    if (!field) continue;
    const { value, error } = coerceValueForField(rawValue, field);
    if (error) {
      errors.push(`${key}: ${error}`);
      continue;
    }
    if (value === undefined) continue;
    output[key] = value;
  }
  return { attributes: output, errors };
}

export function upsertProviderAttributes(state, { sessionId, handle, attributes = {}, replace = false }) {
  if (!sessionId || !state) return null;
  if (!state.profileAttributes) {
    state.profileAttributes = [];
  }
  const now = new Date().toISOString();
  const existingIndex = state.profileAttributes.findIndex((entry) => entry.sessionId === sessionId);
  const existing = existingIndex >= 0 ? state.profileAttributes[existingIndex] : null;
  const schemaVersion = Number(state?.settings?.profileSchema?.version);
  const resolvedSchemaVersion = Number.isFinite(schemaVersion) ? schemaVersion : existing?.schemaVersion || 0;
  const providerPayload = replace ? { ...attributes } : { ...(existing?.provider || {}), ...attributes };
  const next = {
    sessionId,
    handle: handle || existing?.handle || '',
    provider: providerPayload,
    updatedAt: now,
    schemaVersion: resolvedSchemaVersion,
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

export function validateProviderFields(fields = []) {
  const errors = [];
  const normalized = [];
  const seen = new Set();
  for (const [index, field] of (fields || []).entries()) {
    const candidate = normalizeProviderField(field, index);
    if (!candidate) {
      errors.push(`Field ${index + 1} is invalid or collides with canonical keys.`);
      continue;
    }
    if (!ALLOWED_TYPES.includes(candidate.type)) {
      errors.push(`Field "${candidate.key}" uses unsupported type "${candidate.type}".`);
      continue;
    }
    if (seen.has(candidate.key)) {
      errors.push(`Duplicate field "${candidate.key}" discarded.`);
      continue;
    }
    seen.add(candidate.key);
    normalized.push(candidate);
  }
  return { fields: normalized, errors };
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
    if (typeof rawValue === 'boolean') return { value: rawValue };
    const text = String(rawValue).trim().toLowerCase();
    if (!text) return { value: undefined, error: field.required ? 'Value empty' : null };
    if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return { value: true };
    if (text === 'false' || text === '0' || text === 'no' || text === 'off') return { value: false };
    return { value: undefined, error: 'Invalid boolean' };
  }
  if (field.type === 'number') {
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      return { value: undefined, error: field.required ? 'Value empty' : null };
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? { value: parsed } : { value: undefined, error: 'Invalid number' };
  }
  if (field.type === 'phone') {
    const textValue = sanitizeText(String(rawValue || ''), 48);
    if (!textValue) return { value: undefined, error: field.required ? 'Phone empty' : null };
    if (!PHONE_REGEX.test(textValue)) return { value: undefined, error: 'Invalid phone format' };
    return { value: textValue };
  }
  const textValue = sanitizeText(String(rawValue || ''), 240);
  if (!textValue) return { value: undefined, error: field.required ? 'Value empty' : null };
  if (field.type === 'email') {
    const lower = textValue.toLowerCase();
    if (!EMAIL_REGEX.test(lower)) return { value: undefined, error: 'Invalid email format' };
    return { value: lower };
  }
  return { value: textValue };
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
