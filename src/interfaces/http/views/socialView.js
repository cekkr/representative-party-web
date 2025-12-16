import { escapeHtml } from '../../shared/utils/text.js';

export function renderSocialPosts(posts) {
  if (!posts || posts.length === 0) {
    return '<p class="muted">No posts yet. Follow someone and start the conversation.</p>';
  }

  return posts
    .map((post) => {
      const visibilityPill =
        post.visibility === 'direct'
          ? '<span class="pill warning">Direct</span>'
          : '<span class="pill ghost">Public</span>';
      const replyPill = post.replyTo ? `<span class="pill ghost">Reply</span>` : '';
      const previewPill = post.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : '';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(post.authorHandle || 'anon')}</span>
            ${visibilityPill}
            ${replyPill}
            ${previewPill}
            <span class="muted small">${new Date(post.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(post.content)}</p>
          ${
            post.visibility === 'direct' && post.targetHandle
              ? `<p class="muted small">To: ${escapeHtml(post.targetHandle)}</p>`
              : ''
          }
          ${post.replyTo ? `<p class="muted small">Replying to ${escapeHtml(post.replyTo)}</p>` : ''}
          <p class="muted small">Author hash: ${escapeHtml(post.authorHash)}</p>
        </article>
      `;
    })
    .join('\n');
}

export function renderFollowList(follows) {
  if (!follows || follows.length === 0) {
    return '<p class="muted">You are not following anyone yet.</p>';
  }

  return follows
    .map((edge) => {
      return `
        <div class="list-row">
          <div>
            <p class="small">${escapeHtml(edge.targetHandle || edge.targetHash)}</p>
            <p class="muted tiny">${escapeHtml(edge.targetHash)}</p>
          </div>
          <div>
            <span class="pill ghost">${escapeHtml(edge.type)}</span>
            <span class="muted tiny">${new Date(edge.createdAt).toLocaleString()}</span>
          </div>
        </div>
      `;
    })
    .join('\n');
}
