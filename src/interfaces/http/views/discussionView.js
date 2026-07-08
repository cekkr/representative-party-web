import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import {
  renderAuthorHashLine,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPreviewPill,
  resolveTopicBreadcrumb,
} from './shared.js';

export function renderDiscussionList(entries, state) {
  if (!entries.length) {
    return renderDiscussionOnboarding();
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
        <article class="topic-card">
          <div class="topic-head">
            <div class="topic-avatar" aria-hidden="true"></div>
            <div class="topic-info">
              <div class="topic-breadcrumbs">Discussion / ${escapeHtml(topicLabel)}</div>
              <div class="topic-meta">
                <span class="pill ghost">${escapeHtml(entry.stance)}</span>
                ${evidencePill}
                ${renderPreviewPill(entry)}
                ${renderIssuerPill(entry)}
                ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="topic-body">
            <p>${escapeHtml(entry.content)}</p>
            ${evidenceBlock}
          </div>
          <div class="topic-footer">
            ${renderAuthorHashLine(entry.authorHash, { state })}
          </div>
        </article>
      `;
    })
    .join('\n');
}

function renderDiscussionOnboarding() {
  return `
    <div class="onboarding-card">
      <p class="eyebrow">Discussion</p>
      <h3>No discussion posts yet</h3>
      <ul class="plain small">
        <li>Pick a topic that needs input.</li>
        <li>Post a concise update or question.</li>
        <li>Add evidence links when available.</li>
      </ul>
      <div class="onboarding-actions">
        <a class="cta" href="#discussion-compose">Start a post</a>
        <a class="ghost" href="#discussion-topics">Set top topics</a>
      </div>
    </div>
  `;
}
