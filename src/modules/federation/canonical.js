export function canonicalizeJson(value) {
  const normalized = normalizeValue(value);
  return JSON.stringify(normalized);
}

export function canonicalizeEnvelope(envelope, { omitKeys = [] } = {}) {
  if (!envelope || typeof envelope !== 'object') return JSON.stringify({});
  const cleaned = { ...envelope };
  for (const key of omitKeys || []) {
    delete cleaned[key];
  }
  return canonicalizeJson(cleaned);
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const next = {};
    for (const key of keys) {
      if (value[key] === undefined) continue;
      next[key] = normalizeValue(value[key]);
    }
    return next;
  }
  return value;
}
