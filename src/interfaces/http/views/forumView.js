import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderActorAvatar, renderActorLabel, resolvePersonHandle } from './actorLabel.js';
import {
  renderEmptyState,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPager,
  renderPreviewPill,
  resolveTopicBreadcrumb,
} from './shared.js';
import { paginate } from '../../../shared/utils/pagination.js';
import { renderContextPanel } from './contextPanel.js';

export function renderForum(entries, person, state, options = {}) {
  const { threads, commentsByThread } = splitForumEntries(entries);
  const pageInfo = paginate(threads, { page: options.page || 1 });
  const postGate = options.postGate;
  return {
    threads: renderThreads(pageInfo.items, commentsByThread, state, options),
    threadsPager: renderPager(pageInfo, { baseHref: '/forum', label: 'threads' }),
    personHandle: resolvePersonHandle(person),
    composeOpen: options.composeOpen || '',
    forumContext: renderContextPanel({
      gates: postGate
        ? [
            {
              label: 'Publish an article',
              status: postGate.allowed ? 'Allowed' : 'Blocked',
              allowed: postGate.allowed,
              reason: postGate.allowed ? '' : postGate.message || postGate.reason || '',
            },
          ]
        : [],
      facts: [
        { term: 'Role', value: person?.role || 'guest' },
        { term: 'Handle', value: resolvePersonHandle(person) || 'Not signed in' },
      ],
      guidance: ['Use the forum for deeper context and evidence-backed analysis; keep quick takes in the social lane.'],
    }),
  };
}

function renderThreads(threads, commentsByThread, state, { replyOpenId } = {}) {
  if (!threads.length) {
    return renderEmptyState('No forum threads yet. Publish an article or analysis.');
  }
  const topicCache = new Map();
  return threads
    .map((thread) => {
      const topicLabel = resolveTopicBreadcrumb(thread, state, topicCache);
      const createdAt = formatTimestamp(thread.createdAt);
      const threadComments = commentsByThread.get(thread.id) || [];
      const replyOpen = replyOpenId && replyOpenId === thread.id ? 'open' : '';
      const safeThreadId = escapeHtml(thread.id);
      const threadAnchor = `thread-${safeThreadId}`;
      const replySummary = `Reply (${threadComments.length})`;
      return `
        <article class="topic-card" id="${threadAnchor}">
          <div class="topic-head">
            ${renderActorAvatar(state, thread.authorHash || 'anonymous')}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, thread.authorHash || 'anonymous')}</span>
                ${createdAt ? `<span class="topic-time muted small">${createdAt}</span>` : ''}
              </div>
              <h3 class="topic-title">${escapeHtml(thread.title || 'Untitled')}</h3>
              <div class="topic-meta">
                <span class="topic-breadcrumbs">Forum / ${escapeHtml(topicLabel)}</span>
                <span class="pill ghost">Replies: ${threadComments.length}</span>
                ${renderPreviewPill(thread)}
                ${renderIssuerPill(thread)}
              </div>
            </div>
          </div>
          <div class="topic-body">
            <p>${escapeHtml(thread.content)}</p>
          </div>
          <div class="reply-list">
            ${renderComments(threadComments, state)}
          </div>
          <details class="reply-composer" ${replyOpen}>
            <summary>
              <div class="reply-hint">
                <div class="reply-hint__meta">
                  <div class="reply-hint__avatar" aria-hidden="true"></div>
                  <div>
                    <div class="reply-hint__title">${replySummary}</div>
                    <div class="reply-hint__subtitle">Share your view and add evidence when needed.</div>
                  </div>
                </div>
                <span class="reply-hint__cta">Reply</span>
              </div>
            </summary>
            <form class="stack reply-composer__form" method="post" action="/forum/comment" data-enhance="forum">
              <input type="hidden" name="parentId" value="${safeThreadId}" />
              <label class="field">
                <span>Comment</span>
                <textarea name="content" rows="3" placeholder="Add your view" required></textarea>
              </label>
              <label class="field">
                <span>Evidence / citations (optional)</span>
                <textarea name="evidenceLinks" rows="2" placeholder="https://example.org/report"></textarea>
              </label>
              <p class="muted small">One URL per line.</p>
              <button class="ghost" type="submit">Comment</button>
            </form>
          </details>
        </article>
      `;
    })
    .join('\n');
}

function splitForumEntries(entries = []) {
  const threads = [];
  const commentsByThread = new Map();
  for (const entry of entries || []) {
    if (!entry) continue;
    if (entry.parentId) {
      const list = commentsByThread.get(entry.parentId) || [];
      list.push(entry);
      commentsByThread.set(entry.parentId, list);
    } else {
      threads.push(entry);
    }
  }
  return { threads, commentsByThread };
}

function renderComments(comments, state) {
  if (!comments.length) {
    return renderEmptyState('No comments yet.', { size: 'small' });
  }
  return comments
    .map((comment) => {
      const createdAt = formatTimestamp(comment.createdAt);
      const evidenceLinks = Array.isArray(comment.evidenceLinks) ? comment.evidenceLinks : [];
      const evidencePill = evidenceLinks.length ? '<span class="pill ghost">Evidence</span>' : '';
      const evidenceBlock = renderEvidenceLinks(evidenceLinks);
      return `
        <article class="reply-card">
          ${renderActorAvatar(state, comment.authorHash || 'anonymous', { size: 'sm' })}
          <div class="reply-card__content">
            <div class="reply-card__meta">
              <span class="topic-author">${renderActorLabel(state, comment.authorHash || 'anonymous')}</span>
              ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
              ${evidencePill}
              ${renderPreviewPill(comment)}
              ${renderIssuerPill(comment)}
            </div>
            <p class="reply-card__text">${escapeHtml(comment.content)}</p>
            ${evidenceBlock}
          </div>
        </article>
      `;
    })
    .join('\n');
}
