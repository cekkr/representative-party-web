import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { resolvePersonHandle } from './actorLabel.js';
import { renderAuthorHashLine, renderEmptyState, renderIssuerPill, resolveTopicBreadcrumb } from './shared.js';

export function renderForum(entries, person, state) {
  const { threads, commentsByThread } = splitForumEntries(entries);
  return {
    threads: renderThreads(threads, commentsByThread, state),
    personHandle: resolvePersonHandle(person),
    roleLabel: person?.role || 'guest',
  };
}

function renderThreads(threads, commentsByThread, state) {
  if (!threads.length) {
    return renderEmptyState('No threads yet. Start a discussion.');
  }
  const topicCache = new Map();
  return threads
    .map((thread) => {
      const topicLabel = resolveTopicBreadcrumb(thread, state, topicCache);
      const createdAt = formatTimestamp(thread.createdAt);
      const threadComments = commentsByThread.get(thread.id) || [];
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(topicLabel)}</span>
            <span class="pill ghost">Article</span>
            ${thread.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(thread)}
            ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
          </div>
          <h3>${escapeHtml(thread.title || 'Untitled')}</h3>
          <p>${escapeHtml(thread.content)}</p>
          ${renderAuthorHashLine(thread.authorHash || 'anonymous')}
          <form class="stack" method="post" action="/forum/comment" data-enhance="forum">
            <input type="hidden" name="parentId" value="${escapeHtml(thread.id)}" />
            <label class="field">
              <span>Comment</span>
              <textarea name="content" rows="2" placeholder="Add your view" required></textarea>
            </label>
            <button class="ghost" type="submit">Comment</button>
          </form>
          <div class="discussion-list">
            ${renderComments(threadComments)}
          </div>
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
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill ghost">Comment</span>
            ${comment.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(comment)}
            ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
          </div>
          <p>${escapeHtml(comment.content)}</p>
          ${renderAuthorHashLine(comment.authorHash || 'anonymous')}
        </article>
      `;
    })
    .join('\n');
}
