import { escapeHtml } from '../../shared/utils/text.js';

export function renderForum(entries, citizen) {
  const threads = entries.filter((e) => !e.parentId);
  const comments = entries.filter((e) => e.parentId);
  return {
    threads: renderThreads(threads, comments, citizen),
    citizenHandle: citizen?.handle || 'Guest',
    roleLabel: citizen?.role || 'guest',
  };
}

function renderThreads(threads, comments, citizen) {
  if (!threads.length) {
    return '<p class="muted">No threads yet. Start a discussion.</p>';
  }
  return threads
    .map((thread) => {
      const threadComments = comments.filter((c) => c.parentId === thread.id);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(thread.topic || 'general')}</span>
            <span class="pill ghost">Article</span>
            <span class="muted small">${new Date(thread.createdAt).toLocaleString()}</span>
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

function renderComments(comments) {
  if (!comments.length) {
    return '<p class="muted small">No comments yet.</p>';
  }
  return comments
    .map((comment) => {
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill ghost">Comment</span>
            <span class="muted small">${new Date(comment.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(comment.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(comment.authorHash || 'anonymous')}</p>
        </article>
      `;
    })
    .join('\n');
}
