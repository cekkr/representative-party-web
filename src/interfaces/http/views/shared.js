import { formatTopicBreadcrumb as formatTopicBreadcrumbFromRegistry } from '../../../modules/topics/registry.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { renderActorLabel } from './actorLabel.js';

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

export function renderPreviewPill(entry) {
  if (entry?.validationStatus === 'preview') {
    return '<span class="pill warning">Preview</span>';
  }
  return '';
}

// Render prev/next pagination controls for a list. `query` holds extra params (e.g. topic
// filter) to preserve across pages; nothing renders when there is only a single page.
export function renderPager(pageInfo, { baseHref = '', query = {}, partial = true, label = 'items' } = {}) {
  if (!pageInfo || pageInfo.pageCount <= 1) return '';
  const buildHref = (page) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    params.set('page', String(page));
    const qs = params.toString();
    return `${baseHref}${qs ? `?${qs}` : ''}`;
  };
  const partialAttr = partial ? ' data-partial' : '';
  const prev = pageInfo.hasPrev
    ? `<a class="ghost" href="${escapeHtml(buildHref(pageInfo.page - 1))}"${partialAttr}>← Newer</a>`
    : '<span class="muted tiny">← Newer</span>';
  const next = pageInfo.hasNext
    ? `<a class="ghost" href="${escapeHtml(buildHref(pageInfo.page + 1))}"${partialAttr}>Older →</a>`
    : '<span class="muted tiny">Older →</span>';
  const summary = `Page ${pageInfo.page} of ${pageInfo.pageCount} · ${pageInfo.startIndex}-${pageInfo.endIndex} of ${pageInfo.total} ${escapeHtml(label)}`;
  return `
    <nav class="pager" aria-label="Pagination">
      ${prev}
      <span class="muted tiny">${summary}</span>
      ${next}
    </nav>
  `;
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

export function renderAuthorHashLine(value, { size = 'small', label, state } = {}) {
  const resolved = value === null || value === undefined ? '' : String(value);
  if (!resolved) return '';
  const className = size === 'tiny' ? 'muted tiny' : 'muted small';
  // When state is available, resolve the hash to a readable @handle (with the short hash
  // kept as a secondary cue); fall back to the raw hash for state-less callers.
  if (state) {
    const effectiveLabel = label || 'Author';
    return `<p class="${className}">${escapeHtml(effectiveLabel)}: ${renderActorLabel(state, resolved)}</p>`;
  }
  const effectiveLabel = label || 'Author hash';
  return `<p class="${className}">${escapeHtml(effectiveLabel)}: ${escapeHtml(resolved)}</p>`;
}

export function renderEvidenceLinks(links = [], { limit = 4, label = 'Evidence' } = {}) {
  const filtered = Array.isArray(links)
    ? links.filter((link) => typeof link === 'string' && /^https?:\/\//i.test(link))
    : [];
  const items = filtered.slice(0, limit).map((link) => {
    const safeLink = escapeHtml(link);
    return `<li><a class="muted small" href="${safeLink}" target="_blank" rel="noreferrer">${safeLink}</a></li>`;
  });
  if (!items.length) return '';
  const labelLine = label ? `<p class="muted small">${escapeHtml(label)}</p>` : '';
  return `
    <div class="stack">
      ${labelLine}
      <ul class="plain small">
        ${items.join('')}
      </ul>
    </div>
  `;
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
