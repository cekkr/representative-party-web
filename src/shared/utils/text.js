export function sanitizeText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, maxLength);
}

export function parseEvidenceLinks(rawInput, { limit = 8, maxLength = 320 } = {}) {
  if (!rawInput) return [];
  const rawLines = Array.isArray(rawInput) ? rawInput : String(rawInput).split(/[\n,]/);
  const links = [];
  const seen = new Set();
  for (const raw of rawLines) {
    const trimmed = sanitizeText(String(raw || '').trim(), maxLength);
    if (!trimmed) continue;
    if (!/^https?:\/\//i.test(trimmed)) continue;
    let normalized = trimmed;
    try {
      normalized = new URL(trimmed).toString();
    } catch (_error) {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
    if (links.length >= limit) break;
  }
  return links;
}

export function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
