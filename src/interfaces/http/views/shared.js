import { formatTopicBreadcrumb as formatTopicBreadcrumbFromRegistry } from '../../../modules/topics/registry.js';
import { escapeHtml } from '../../../shared/utils/text.js';

export function resolveTopicBreadcrumb(entry, state, cache) {
  const cacheKey = buildTopicCacheKey(entry);
  if (cache && cacheKey && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  let resolved = '';
  if (entry?.topicId && state) {
    const live = formatTopicBreadcrumbFromRegistry(state, entry.topicId);
    if (live) resolved = live;
  }
  if (!resolved && Array.isArray(entry?.topicPath) && entry.topicPath.length) {
    resolved = entry.topicPath.join(' / ');
  }
  if (!resolved && entry?.topicBreadcrumb) resolved = entry.topicBreadcrumb;
  if (!resolved) resolved = entry?.topic || 'general';
  if (cache && cacheKey) {
    cache.set(cacheKey, resolved);
  }
  return resolved;
}

export function renderIssuerPill(entry) {
  const issuer = entry?.issuer || entry?.provenance?.issuer;
  if (!issuer) return '';
  return `<span class="pill ghost">from ${escapeHtml(String(issuer))}</span>`;
}

export function renderEmptyState(message, { size = 'normal' } = {}) {
  if (!message) return '';
  const sizeClass = size === 'small' ? 'muted small' : size === 'tiny' ? 'muted tiny' : 'muted';
  return `<p class="${sizeClass}">${escapeHtml(String(message))}</p>`;
}

export function renderCalloutRow(message, { className = 'muted small' } = {}) {
  const text = typeof message === 'string' ? message.trim() : message;
  if (!text) return '';
  return `<p class="${className}">${escapeHtml(String(text))}</p>`;
}

export function renderAuthorHashLine(value, { size = 'small', label = 'Author hash' } = {}) {
  const resolved = value === null || value === undefined ? '' : String(value);
  if (!resolved) return '';
  const className = size === 'tiny' ? 'muted tiny' : 'muted small';
  return `<p class="${className}">${escapeHtml(label)}: ${escapeHtml(resolved)}</p>`;
}

function buildTopicCacheKey(entry) {
  if (entry?.topicId) return `id:${entry.topicId}`;
  if (Array.isArray(entry?.topicPath) && entry.topicPath.length) {
    return `path:${JSON.stringify(entry.topicPath)}`;
  }
  if (entry?.topicBreadcrumb) return `crumb:${entry.topicBreadcrumb}`;
  if (entry?.topic) return `topic:${entry.topic}`;
  return null;
}
