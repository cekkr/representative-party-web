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
import { discussionHref } from '../../../modules/discussion/discussionLinks.js';
import { describePromotionTrail } from '../../../modules/groups/promotion.js';

export function renderDiscussionList(entries, state, options = {}) {
  if (!entries.length) {
    return renderDiscussionOnboarding(options);
  }

  const posts = entries.map((entry) => `<li>${renderDiscussionPost(entry, state, options)}</li>`);
  return `<ul class="discussion-list">${posts.join('')}</ul>`;
}

export function renderDiscussionPost(entry, state, options = {}) {
  const topicLabel = escapeHtml(resolveTopicBreadcrumb(entry, state, options.topicCache));
  const summary = String(entry.content || '').slice(0, 75);
  const href = discussionHref({ ...options.browse, groupId: entry.groupId, post: entry.id });
  const createdAt = formatTimestamp(entry.createdAt);
  const evidenceLinks = Array.isArray(entry.evidenceLinks) ? entry.evidenceLinks : [];
  const evidenceBlock = renderEvidenceLinks(evidenceLinks);
  const stance = entry.stance ? `<span class="pill stance stance--${escapeHtml(String(entry.stance))}">${escapeHtml(entry.stance)}</span>` : '';
  const promotionNote = describePromotionTrail(entry);
  const promotionPill = promotionNote ? `<span class="pill ghost">${escapeHtml(promotionNote)}</span>` : '';
  const promote = renderPromoteControl(entry, options);
  const caseAction = options.caseAction?.(entry);
  const promotionRequests = renderPromotionRequestControls(entry, options, {
    action: options.actionHref || '/discussion',
    idField: 'discussionId',
  });
  return `
    <article class="topic-card">
      <div class="topic-head">
        ${renderActorAvatar(state, entry.authorHash)}
        <div class="topic-info">
          <div class="topic-byline">
            <span class="topic-author">${renderActorLabel(state, entry.authorHash)}</span>
            ${createdAt ? `<time class="topic-time muted small" datetime="${escapeHtml(String(entry.createdAt))}">${createdAt}</time>` : ''}
          </div>
          <div class="topic-meta">
            ${options.focused ? '' : `<a class="topic-breadcrumbs contribution-link" href="${escapeHtml(href)}" data-partial>${topicLabel}<span class="sr-only"> · ${escapeHtml(summary)}</span></a>`}
            ${stance}
            ${promotionPill}
            ${renderPreviewPill(entry)}
            ${renderIssuerPill(entry, { localIssuer: state?.issuer })}
          </div>
        </div>
      </div>
      <div class="topic-body">
        <p>${escapeHtml(entry.content)}</p>
        ${evidenceBlock}
        ${caseAction ? `<a class="pill ghost" href="${escapeHtml(caseAction.href)}" data-partial>${escapeHtml(caseAction.label)}</a>` : ''}
        ${promote}
        ${promotionRequests}
      </div>
    </article>
  `;
}

// "Move up a level" is only offered when it would actually succeed — the caller passes a
// predicate that runs the same checks the POST handler will, so the control never promises
// an action that is about to be refused.
function renderPromoteControl(entry, options = {}) {
  if (typeof options.promotable !== 'function') return '';
  const decision = options.promotable(entry);
  if (!decision?.ok) return '';
  return `
    <form class="form-inline" method="post" action="${escapeHtml(options.actionHref || '/discussion')}" data-enhance="discussion-promote">
      <input type="hidden" name="intent" value="promote" />
      <input type="hidden" name="discussionId" value="${escapeHtml(String(entry.id))}" />
      <button type="submit" class="ghost">Move up to ${escapeHtml(decision.targetLabel)}</button>
    </form>
  `;
}

function renderDiscussionOnboarding({ groupId, createHref, clearFilterHref, browse }) {
  if (clearFilterHref) {
    return `
      <div class="onboarding-card">
        <h3>${browse?.q ? 'No posts match these filters' : 'No posts match this topic'}</h3>
        <div class="onboarding-actions">
          <a class="ghost" href="${escapeHtml(clearFilterHref)}" data-partial>${browse?.q ? 'Clear filters' : 'Clear topic filter'}</a>
        </div>
      </div>
    `;
  }
  const title = groupId ? "No posts in this group's lane yet" : 'No discussion posts yet';
  const guidance = groupId
    ? 'Posts here stay in the group lane until they are moved up a level.'
    : 'Share an update or question and add evidence links when available.';
  return `
    <div class="onboarding-card">
      <h3>${title}</h3>
      ${createHref ? `<p class="muted small">${guidance}</p>
        <div class="onboarding-actions">
          <a class="ghost" href="${escapeHtml(createHref)}" data-discussion-compose-link data-partial>Start a post</a>
        </div>` : ''}
    </div>
  `;
}
