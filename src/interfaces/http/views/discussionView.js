import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderEmptyState, renderIssuerPill, resolveTopicBreadcrumb } from './shared.js';

export function renderDiscussionList(entries, state) {
  if (!entries.length) {
    return renderEmptyState('No contributions yet. Be the first to start the debate.');
  }

  const topicCache = new Map();
  return entries
    .map((entry) => {
      const topicLabel = resolveTopicBreadcrumb(entry, state, topicCache);
      const createdAt = formatTimestamp(entry.createdAt);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(topicLabel)}</span>
            <span class="pill ghost">${escapeHtml(entry.stance)}</span>
            ${entry.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(entry)}
            ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
          </div>
          <p>${escapeHtml(entry.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(entry.authorHash)}</p>
        </article>
      `;
    })
    .join('\n');
}
