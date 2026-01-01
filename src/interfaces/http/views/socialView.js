import { escapeHtml } from '../../../shared/utils/text.js';
import { renderIssuerPill } from './shared.js';

export function renderSocialPosts(posts, { enableReplies = false, followTypeByHash, mediaById } = {}) {
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
      const inboundPill = post.activityPub?.inbound ? '<span class="pill ghost">ActivityPub</span>' : '';
      const contentBlock = post.content ? `<p>${escapeHtml(post.content)}</p>` : '';
      const reshareBlock = renderReshare(post, mediaById);
      const mediaBlock = renderMediaAttachments(post.mediaIds || [], mediaById);
      const mediaHasBlocked =
        hasBlockedMediaIds(post.mediaIds || [], mediaById) || hasBlockedMediaIds(post.reshare?.mediaIds || [], mediaById);
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
            ${inboundPill}
            ${followTypePill}
            ${renderIssuerPill(post)}
            <span class="muted small">${new Date(post.createdAt).toLocaleString()}</span>
          </div>
          ${contentBlock}
          ${mediaBlock}
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
          ${enableReplies && !mediaHasBlocked ? renderReshareForm(post) : ''}
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

function renderReshare(post, mediaById) {
  if (!post.reshare) return '';
  const author = escapeHtml(post.reshare.authorHandle || post.reshare.authorHash || 'unknown');
  const content = escapeHtml(post.reshare.content || '');
  const created = post.reshare.createdAt ? new Date(post.reshare.createdAt).toLocaleString() : '';
  const mediaBlock = renderMediaAttachments(post.reshare.mediaIds || [], mediaById);
  return `
    <div class="callout">
      <p class="muted small">Reshared from ${author}${created ? ` · ${created}` : ''}</p>
      ${content ? `<p>${content}</p>` : '<p class="muted small">Original content hidden.</p>'}
      ${mediaBlock}
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

function renderMediaAttachments(mediaIds = [], mediaById) {
  if (!mediaIds.length) return '';
  const cards = mediaIds
    .map((mediaId) => {
      const media = mediaById?.get?.(mediaId);
      if (!media) {
        return `
          <div class="media-card locked">
            <p class="muted small">Media unavailable.</p>
          </div>
        `;
      }
      const label = `${media.kind === 'video' ? 'Video' : 'Photo'} · ${formatBytes(media.size || 0)}`;
      const name = media.originalName ? ` · ${escapeHtml(media.originalName)}` : '';
      if (media.status === 'blocked') {
        return `
          <div class="media-card blocked">
            <p class="muted small">Blocked media · ${label}${name}</p>
            <p class="muted tiny">Provider policy prevents viewing or resharing.</p>
          </div>
        `;
      }
      if (media.status === 'locked') {
        return `
          <div class="media-card locked">
            <p class="muted small">Locked media · ${label}${name}</p>
            <p class="muted tiny">Viewing requires an explicit request.</p>
            <div class="cta-row">
              <a class="ghost" href="/social/media/${escapeHtml(media.id)}?view=1" target="_blank" rel="noreferrer">Request view</a>
              ${renderMediaReportForm(media)}
            </div>
          </div>
        `;
      }
      const src = `/social/media/${escapeHtml(media.id)}?view=1`;
      const mediaTag =
        media.kind === 'video'
          ? `<video class="media-embed" controls preload="metadata" src="${src}"></video>`
          : `<img class="media-embed" src="${src}" alt="Shared media" loading="lazy" />`;
      return `
        <div class="media-card">
          <p class="muted small">${label}${name}</p>
          ${mediaTag}
          <div class="cta-row">
            ${renderMediaReportForm(media)}
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="media-stack">${cards}</div>`;
}

function renderMediaReportForm(media) {
  return `
    <form method="post" action="/social/media/report" data-enhance="social-media-report">
      <input type="hidden" name="mediaId" value="${escapeHtml(media.id)}" />
      <button class="ghost" type="submit">Report media</button>
    </form>
  `;
}

function hasBlockedMediaIds(mediaIds = [], mediaById) {
  if (!mediaIds.length || !mediaById) return false;
  return mediaIds.some((mediaId) => mediaById.get(mediaId)?.status === 'blocked');
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
