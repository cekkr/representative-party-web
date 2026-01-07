import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { resolvePersonHandle } from './actorLabel.js';
import { renderIssuerPill, resolveTopicBreadcrumb } from './shared.js';

export function renderForum(entries, person, state) {
  const threads = entries.filter((e) => !e.parentId);
  const comments = entries.filter((e) => e.parentId);
  const commentsByThread = groupCommentsByParent(comments);
  return {
    threads: renderThreads(threads, commentsByThread, state),
    personHandle: resolvePersonHandle(person),
    roleLabel: person?.role || 'guest',
  };
}

function renderThreads(threads, commentsByThread, state) {
  if (!threads.length) {
    return '<p class="muted">No threads yet. Start a discussion.</p>';
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
          <p class="muted small">Author hash: ${escapeHtml(thread.authorHash || 'anonymous')}</p>
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

function groupCommentsByParent(comments = []) {
  const map = new Map();
  for (const comment of comments) {
    if (!comment?.parentId) continue;
    const list = map.get(comment.parentId) || [];
    list.push(comment);
    map.set(comment.parentId, list);
  }
  return map;
}

function renderComments(comments) {
  if (!comments.length) {
    return '<p class="muted small">No comments yet.</p>';
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
          <p class="muted small">Author hash: ${escapeHtml(comment.authorHash || 'anonymous')}</p>
        </article>
      `;
    })
    .join('\n');
}
