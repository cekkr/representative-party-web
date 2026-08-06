import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderActorAvatar, renderActorLabel } from './actorLabel.js';
import {
  renderEvidenceLinks,
  renderIssuerPill,
  renderPreviewPill,
  renderPromotionRequestControls,
  resolveTopicBreadcrumb,
} from './shared.js';
import { describePromotionTrail } from '../../../modules/groups/promotion.js';

export function renderDiscussionList(entries, state, options = {}) {
  if (!entries.length) {
    return renderDiscussionOnboarding(options);
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
      const promotionNote = describePromotionTrail(entry);
      const promotionPill = promotionNote ? `<span class="pill ghost">${escapeHtml(promotionNote)}</span>` : '';
      const promote = renderPromoteControl(entry, options);
      const promotionRequests = renderPromotionRequestControls(entry, options, {
        action: '/discussion',
        idField: 'discussionId',
      });
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
                ${promotionPill}
                ${renderPreviewPill(entry)}
                ${renderIssuerPill(entry)}
              </div>
            </div>
          </div>
          <div class="topic-body">
            <p>${escapeHtml(entry.content)}</p>
            ${evidenceBlock}
            ${promote}
            ${promotionRequests}
          </div>
        </article>
      `;
    })
    .join('\n');
}

// "Move up a level" is only offered when it would actually succeed — the caller passes a
// predicate that runs the same checks the POST handler will, so the control never promises
// an action that is about to be refused.
function renderPromoteControl(entry, options = {}) {
  if (typeof options.promotable !== 'function') return '';
  const decision = options.promotable(entry);
  if (!decision?.ok) return '';
  return `
    <form class="form-inline" method="post" action="/discussion" data-enhance="discussion-promote">
      <input type="hidden" name="intent" value="promote" />
      <input type="hidden" name="discussionId" value="${escapeHtml(String(entry.id))}" />
      <button type="submit" class="ghost">Move up to ${escapeHtml(decision.targetLabel)}</button>
    </form>
  `;
}

function renderDiscussionOnboarding(options = {}) {
  if (options.groupId) {
    return `
      <div class="onboarding-card">
        <p class="eyebrow">Group discussion</p>
        <h3>No posts in this group's lane yet</h3>
        <p class="muted small">This lane is internal to the group. Posts here stay out of the Circle feed until they are moved up a level.</p>
        <div class="onboarding-actions">
          <a class="cta" href="#discussion-compose">Start a post</a>
        </div>
      </div>
    `;
  }
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
