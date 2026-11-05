import { escapeHtml } from '../../../shared/utils/text.js';
import { renderEmptyState } from './shared.js';

export function renderHomePills(items = []) {
  const filtered = (items || []).filter((item) => item && item.label);
  if (!filtered.length) return '';
  return filtered
    .map((item) => {
      const tone = item.tone === 'warning' ? 'pill warning' : item.tone === 'plain' ? 'pill' : 'pill ghost';
      return `<span class="${tone}">${escapeHtml(String(item.label))}</span>`;
    })
    .join('\n');
}

export function renderHomeStats(stats = []) {
  const filtered = (stats || []).filter((item) => item && item.label);
  if (!filtered.length) return '';
  return filtered
    .map((item) => {
      const value = item.value === undefined || item.value === null ? '0' : String(item.value);
      const detail = item.detail ? `<p class="muted tiny">${escapeHtml(String(item.detail))}</p>` : '';
      return `
        <article class="home-stat">
          <p class="eyebrow">${escapeHtml(String(item.label))}</p>
          <p class="home-stat__value">${escapeHtml(value)}</p>
          ${detail}
        </article>
      `;
    })
    .join('\n');
}

export function renderHomeAccessList(items = []) {
  const filtered = (items || []).filter((item) => item && item.label);
  if (!filtered.length) {
    return renderEmptyState('No access details available.', { size: 'small' });
  }
  return filtered
    .map((item) => {
      const tone = item.tone === 'warning' ? 'pill warning' : item.tone === 'ok' ? 'pill' : 'pill ghost';
      const detail = item.detail ? `<p class="muted small">${escapeHtml(String(item.detail))}</p>` : '';
      return `
        <article class="home-access__item">
          <div class="home-access__row">
            <p class="small">${escapeHtml(String(item.label))}</p>
            <span class="${tone}">${escapeHtml(String(item.status || 'Unknown'))}</span>
          </div>
          ${detail}
        </article>
      `;
    })
    .join('\n');
}

export function renderHomeList(items = [], { emptyMessage = 'No recent activity yet.' } = {}) {
  const filtered = (items || []).filter((item) => item && item.title);
  if (!filtered.length) {
    return renderEmptyState(emptyMessage, { size: 'small' });
  }
  return `
    <ul class="home-list">
      ${filtered.map((item) => renderHomeListItem(item)).join('\n')}
    </ul>
  `;
}

function renderHomeListItem(item = {}) {
  const title = item.href
    ? `<a class="home-list__title" href="${escapeHtml(String(item.href))}" ${item.partial ? 'data-partial' : ''}>${escapeHtml(String(item.title))}</a>`
    : `<p class="home-list__title">${escapeHtml(String(item.title))}</p>`;
  const summary = item.summary ? `<p class="muted small">${escapeHtml(String(item.summary))}</p>` : '';
  const meta = item.meta ? `<p class="muted tiny">${escapeHtml(String(item.meta))}</p>` : '';
  const pills = Array.isArray(item.pills) && item.pills.length ? `<div class="discussion__meta">${renderHomePills(item.pills)}</div>` : '';
  return `
    <li class="home-list__item">
      ${title}
      ${summary}
      ${pills}
      ${meta}
    </li>
  `;
}
