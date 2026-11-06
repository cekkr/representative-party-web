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

// Provenance is only worth surfacing when content came from *another* provider.
// Locally-authored content carries the built-in 'local-circle' issuer (or the
// provider's own issuer); tagging every home post "from local-circle" is pure noise,
// so the pill only renders for a genuinely foreign issuer.
export function renderIssuerPill(entry, { localIssuer } = {}) {
  const issuer = entry?.issuer || entry?.provenance?.issuer;
  if (!issuer) return '';
  const normalized = String(issuer).trim();
  if (!normalized || normalized === 'local-circle') return '';
  if (localIssuer && normalized === String(localIssuer).trim()) return '';
  return `<span class="pill ghost">from ${escapeHtml(normalized)}</span>`;
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


// Promotion request controls, shared by the discussion and proposal lanes so the two read
// identically. `options.requestable` / `options.decidable` are predicates that run the same
// checks the POST handlers will, so a control is only ever shown when it would succeed.
export function renderPromotionRequestControls(entry, options = {}, { action, idField } = {}) {
  const parts = [];
  const open = (entry?.promotionRequests || []).find((request) => request.status === 'open');

  if (open) {
    const note = open.note ? ` — “${escapeHtmlSafe(open.note)}”` : '';
    parts.push(
      `<p class="muted small">A member asked for this to move up to ${escapeHtmlSafe(open.targetLabel || 'the upper level')}${note}</p>`,
    );
  }

  if (typeof options.decidable === 'function') {
    const decision = options.decidable(entry);
    if (decision?.ok) {
      parts.push(`
        <form class="form-inline" method="post" action="${escapeHtmlSafe(action)}" data-enhance="promotion-decision">
          <input type="hidden" name="intent" value="promote-decide" />
          <input type="hidden" name="${escapeHtmlSafe(idField)}" value="${escapeHtmlSafe(String(entry.id))}" />
          <input name="reason" aria-label="Decision reason" placeholder="Reason (optional)" />
          <button type="submit" name="decision" value="approve" class="ghost">Approve move to ${escapeHtmlSafe(decision.targetLabel)}</button>
          <button type="submit" name="decision" value="decline" class="ghost">Decline</button>
        </form>
      `);
    }
  }

  if (typeof options.requestable === 'function') {
    const request = options.requestable(entry);
    if (request?.ok) {
      parts.push(`
        <form class="form-inline" method="post" action="${escapeHtmlSafe(action)}" data-enhance="promotion-request">
          <input type="hidden" name="intent" value="promote-request" />
          <input type="hidden" name="${escapeHtmlSafe(idField)}" value="${escapeHtmlSafe(String(entry.id))}" />
          <input name="note" aria-label="Reason for requesting the move" placeholder="Why should this move up?" />
          <button type="submit" class="ghost">Ask to move up to ${escapeHtmlSafe(request.targetLabel)}</button>
        </form>
      `);
    }
  }

  const declined = (entry?.promotionRequests || []).filter((request) => request.status === 'declined').slice(-1)[0];
  if (declined && !open) {
    const reason = declined.reason ? `: ${escapeHtmlSafe(declined.reason)}` : '';
    parts.push(`<p class="muted tiny">A previous request to move this up was declined${reason}</p>`);
  }

  return parts.join('\n');
}

function escapeHtmlSafe(value) {
  return escapeHtml(String(value ?? ''));
}
