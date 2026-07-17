import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderActorAvatar, renderActorLabel } from './actorLabel.js';
import {
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
      const stance = entry.stance ? `<span class="pill stance stance--${escapeHtml(String(entry.stance))}">${escapeHtml(entry.stance)}</span>` : '';
      return `
        <article class="topic-card">
          <div class="topic-head">
            ${renderActorAvatar(state, entry.authorHash)}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, entry.authorHash)}</span>
                ${createdAt ? `<span class="topic-time muted small">${createdAt}</span>` : ''}
              </div>
              <div class="topic-meta">
                <span class="topic-breadcrumbs">Discussion / ${escapeHtml(topicLabel)}</span>
                ${stance}
                ${evidencePill}
                ${renderPreviewPill(entry)}
                ${renderIssuerPill(entry)}
              </div>
            </div>
          </div>
          <div class="topic-body">
            <p>${escapeHtml(entry.content)}</p>
            ${evidenceBlock}
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
