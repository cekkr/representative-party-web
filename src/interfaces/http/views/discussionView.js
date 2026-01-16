import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import {
  renderAuthorHashLine,
  renderEmptyState,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPreviewPill,
  resolveTopicBreadcrumb,
} from './shared.js';

export function renderDiscussionList(entries, state) {
  if (!entries.length) {
    return renderEmptyState('No contributions yet. Be the first to start the debate.');
  }

  const topicCache = new Map();
  return entries
    .map((entry) => {
      const topicLabel = resolveTopicBreadcrumb(entry, state, topicCache);
      const createdAt = formatTimestamp(entry.createdAt);
      const evidenceLinks = Array.isArray(entry.evidenceLinks) ? entry.evidenceLinks : [];
      const evidencePill = evidenceLinks.length ? '<span class="pill ghost">Evidence</span>' : '';
      const evidenceBlock = renderEvidenceLinks(evidenceLinks);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(topicLabel)}</span>
            <span class="pill ghost">${escapeHtml(entry.stance)}</span>
            ${evidencePill}
            ${renderPreviewPill(entry)}
            ${renderIssuerPill(entry)}
            ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
          </div>
          <p>${escapeHtml(entry.content)}</p>
          ${evidenceBlock}
          ${renderAuthorHashLine(entry.authorHash)}
        </article>
      `;
    })
    .join('\n');
}
