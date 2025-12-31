import { escapeHtml } from '../../../shared/utils/text.js';

export function renderSocialPosts(posts, { enableReplies = false, followTypeByHash } = {}) {
  if (!posts || posts.length === 0) {
    return '<p class="muted">No posts yet. Follow someone and start the conversation.</p>';
  }

  return posts
    .map((post) => {
      const followType = followTypeByHash?.get?.(post.authorHash);
      const followTypePill = followType ? `<span class="pill ghost">Follow: ${escapeHtml(followType)}</span>` : '';
      const visibilityPill =
        post.visibility === 'direct'
          ? '<span class="pill warning">Direct</span>'
          : '<span class="pill ghost">Public</span>';
      const replyPill = post.replyTo ? `<span class="pill ghost">Reply</span>` : '';
      const resharePill = post.reshareOf ? `<span class="pill ghost">Reshare</span>` : '';
      const previewPill = post.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : '';
      const contentBlock = post.content ? `<p>${escapeHtml(post.content)}</p>` : '';
      const reshareBlock = renderReshare(post);
      const tagsLine = renderTags(post.tags || []);
      const mentionsLine = renderMentions(post.mentions || []);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(post.authorHandle || 'anon')}</span>
            ${visibilityPill}
            ${replyPill}
            ${resharePill}
            ${previewPill}
            ${followTypePill}
            ${renderIssuerPill(post)}
            <span class="muted small">${new Date(post.createdAt).toLocaleString()}</span>
          </div>
          ${contentBlock}
          ${reshareBlock}
          ${
            post.visibility === 'direct' && post.targetHandle
              ? `<p class="muted small">To: ${escapeHtml(post.targetHandle)}</p>`
              : ''
          }
          ${post.replyTo ? `<p class="muted small">Replying to ${escapeHtml(post.replyTo)}</p>` : ''}
          ${mentionsLine}
          ${tagsLine}
          <p class="muted small">Author hash: ${escapeHtml(post.authorHash)}</p>
          ${enableReplies ? renderReplyForm(post) : ''}
          ${enableReplies ? renderReshareForm(post) : ''}
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

function renderReplyForm(post) {
  const targetValue = post.authorHandle ? escapeHtml(post.authorHandle) : '';
  return `
    <form class="stack bordered" method="post" action="/social/reply" data-enhance="social-reply">
      <input type="hidden" name="replyTo" value="${escapeHtml(post.id)}" />
      <label class="field">
        <span class="muted small">Reply</span>
        <textarea name="content" rows="2" placeholder="Reply to ${escapeHtml(post.authorHandle || 'author')}" required></textarea>
      </label>
      <div class="form-grid">
        <label class="field">
          <span>Visibility</span>
          <select name="visibility">
            <option value="public" selected>Public</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label class="field">
          <span>Direct to (handle, optional)</span>
          <input name="targetHandle" value="${targetValue}" placeholder="@handle" />
        </label>
      </div>
      <button class="ghost" type="submit">Send reply</button>
    </form>
  `;
}

function renderReshare(post) {
  if (!post.reshare) return '';
  const author = escapeHtml(post.reshare.authorHandle || post.reshare.authorHash || 'unknown');
  const content = escapeHtml(post.reshare.content || '');
  const created = post.reshare.createdAt ? new Date(post.reshare.createdAt).toLocaleString() : '';
  return `
    <div class="callout">
      <p class="muted small">Reshared from ${author}${created ? ` · ${created}` : ''}</p>
      ${content ? `<p>${content}</p>` : '<p class="muted small">Original content hidden.</p>'}
    </div>
  `;
}

function renderTags(tags) {
  if (!tags.length) return '';
  const pills = tags.map((tag) => `<span class="pill ghost">#${escapeHtml(tag)}</span>`).join(' ');
  return `<div class="discussion__meta">${pills}</div>`;
}

function renderMentions(mentions) {
  if (!mentions.length) return '';
  return `<p class="muted small">Mentions: ${mentions.map((m) => `@${escapeHtml(m)}`).join(', ')}</p>`;
}

function renderReshareForm(post) {
  if (post.visibility === 'direct') return '';
  return `
    <form class="stack bordered" method="post" action="/social/post" data-enhance="social-reshare">
      <input type="hidden" name="reshareOf" value="${escapeHtml(post.id)}" />
      <label class="field">
        <span class="muted small">Add a comment (optional)</span>
        <textarea name="content" rows="2" placeholder="Optional comment"></textarea>
      </label>
      <button class="ghost" type="submit">Reshare</button>
    </form>
  `;
}

function renderIssuerPill(post) {
  const issuer = post.issuer || post.provenance?.issuer;
  if (!issuer) return '';
  return `<span class="pill ghost">from ${escapeHtml(String(issuer))}</span>`;
}
