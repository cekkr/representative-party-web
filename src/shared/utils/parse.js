export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
}

export function normalizeVerbosityMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'compact') return 'compact';
  if (normalized === 'full') return 'full';
  return null;
}
