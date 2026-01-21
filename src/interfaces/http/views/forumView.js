import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { resolvePersonHandle } from './actorLabel.js';
import {
  renderAuthorHashLine,
  renderEmptyState,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPreviewPill,
  resolveTopicBreadcrumb,
} from './shared.js';

export function renderForum(entries, person, state, options = {}) {
  const { threads, commentsByThread } = splitForumEntries(entries);
  return {
    threads: renderThreads(threads, commentsByThread, state, options),
    personHandle: resolvePersonHandle(person),
    roleLabel: person?.role || 'guest',
    composeOpen: options.composeOpen || '',
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
            <div class="topic-avatar" aria-hidden="true"></div>
            <div class="topic-info">
              <div class="topic-breadcrumbs">Forum / ${escapeHtml(topicLabel)}</div>
              <h3 class="topic-title">${escapeHtml(thread.title || 'Untitled')}</h3>
              <div class="topic-meta">
                <span class="pill ghost">Article</span>
                <span class="pill ghost">Replies: ${threadComments.length}</span>
                ${renderPreviewPill(thread)}
                ${renderIssuerPill(thread)}
                ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="topic-body">
            <p>${escapeHtml(thread.content)}</p>
          </div>
          <div class="topic-footer">
            ${renderAuthorHashLine(thread.authorHash || 'anonymous')}
          </div>
          <div class="reply-list">
            ${renderComments(threadComments)}
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

function renderComments(comments) {
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
          <div class="reply-card__avatar" aria-hidden="true"></div>
          <div class="reply-card__content">
            <div class="reply-card__meta">
              <span class="pill ghost">Comment</span>
              ${evidencePill}
              ${renderPreviewPill(comment)}
              ${renderIssuerPill(comment)}
              ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
            </div>
            <p class="reply-card__text">${escapeHtml(comment.content)}</p>
            ${evidenceBlock}
            ${renderAuthorHashLine(comment.authorHash || 'anonymous')}
          </div>
        </article>
      `;
    })
    .join('\n');
}
