import { escapeHtml } from '../../../shared/utils/text.js';
import { renderIssuerPill, resolveTopicBreadcrumb } from './shared.js';

export function renderDiscussionList(entries, state) {
  if (!entries.length) {
    return '<p class="muted">No contributions yet. Be the first to start the debate.</p>';
  }

  return entries
    .map((entry) => {
      const topicLabel = resolveTopicBreadcrumb(entry, state);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(topicLabel)}</span>
            <span class="pill ghost">${escapeHtml(entry.stance)}</span>
            ${entry.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(entry)}
            <span class="muted small">${new Date(entry.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(entry.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(entry.authorHash)}</p>
        </article>
      `;
    })
    .join('\n');
}
