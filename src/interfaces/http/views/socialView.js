import { escapeHtml, formatBytes } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderActorAvatar, renderActorLabel, resolveHandleForHash } from './actorLabel.js';
import { renderEmptyState, renderIssuerPill, renderPreviewPill } from './shared.js';
import { socialPostHref } from '../../../modules/social/socialLinks.js';

export function renderSocialPosts(posts, options = {}) {
  if (!posts || posts.length === 0) {
    return renderSocialOnboarding(options);
  }

  const { enableActions, viewerHash, followTypeByHash, mediaById, openReplyId, openReshareId, resolveParent, focusedId, state } = options;
  const pagePosts = new Map(posts.map((post) => [post.id, post]));
  const rows = posts
    .map((post) => {
      const followType = followTypeByHash?.get?.(post.authorHash);
      const followTypePill = followType ? `<span class="pill ghost">Follow: ${escapeHtml(followType)}</span>` : '';
      const direct = post.visibility === 'direct';
      const recipient = direct && post.targetHash ? renderActorLabel(state, post.targetHash, { showHash: false }) : 'recipient';
      const visibilityPill = direct
        ? `<span class="pill warning">${post.targetHash === viewerHash ? 'Direct to you' : `Direct to ${recipient}`}</span>`
        : '<span class="pill ghost">Public</span>';
      const replyPill = post.replyTo ? `<span class="pill ghost">Reply</span>` : '';
      const resharePill = post.reshareOf ? `<span class="pill ghost">Reshare</span>` : '';
      const previewPill = renderPreviewPill(post);
      const inboundPill = post.activityPub?.inbound ? '<span class="pill ghost">ActivityPub</span>' : '';
      const createdAt = formatTimestamp(post.createdAt);
      const contentBlock = post.content ? `<p>${escapeHtml(post.content)}</p>` : '';
      const reshareBlock = renderReshare(post, options);
      const mediaBlock = renderMediaAttachments(post.mediaIds || [], options);
      const mediaHasBlocked =
        hasBlockedMediaIds(post.mediaIds || [], mediaById) || hasBlockedMediaIds(post.reshare?.mediaIds || [], mediaById);
      const tagsLine = renderTags(post.tags || []);
      const mentionsLine = renderMentions(post.mentions || []);
      const authorLabel = post.authorHash
        ? renderActorLabel(state, post.authorHash)
        : `<span class="actor">@${escapeHtml(post.authorHandle || 'anonymous')}</span>`;
      // The parent is linked only when this viewer can read it. On the focused view
      // the header already names the parent of the opened update.
      const parent = post.id === focusedId ? null
        : pagePosts.get(post.replyTo) || (post.replyTo && resolveParent ? resolveParent(post.replyTo) : null);
      const parentHandle = parent && resolveHandleForHash(state, parent.authorHash);
      const parentHref = parent && (pagePosts.has(parent.id) || parent.id === focusedId
        ? `#social-post-${encodeURIComponent(parent.id)}`
        : socialPostHref(parent.id));
      const permalink = socialPostHref(post.id);
      return `
        <li><article class="topic-card social-post" id="social-post-${escapeHtml(post.id)}" tabindex="-1">
          <div class="topic-head">
            ${renderActorAvatar(state, post.authorHash || post.authorHandle || 'anonymous', { size: 'sm' })}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${authorLabel}</span>
                ${createdAt
                  ? `<a class="topic-time muted small" href="${escapeHtml(permalink)}" data-partial aria-label="Open update from ${escapeHtml(createdAt)}"><time datetime="${escapeHtml(String(post.createdAt))}">${createdAt}</time></a>`
                  : `<a class="topic-time muted small" href="${escapeHtml(permalink)}" data-partial>Open update</a>`}
              </div>
              <div class="topic-meta">
                ${visibilityPill}
                ${replyPill}
                ${resharePill}
                ${previewPill}
                ${inboundPill}
                ${followTypePill}
                ${renderIssuerPill(post, { localIssuer: state?.issuer })}
              </div>
            </div>
          </div>
          <div class="topic-body">
            ${parentHandle ? `<p class="muted small">Reply to <a href="${escapeHtml(parentHref)}"${parentHref.startsWith('#') ? '' : ' data-partial'}>@${escapeHtml(parentHandle)}</a></p>` : ''}
            ${contentBlock}
            ${mediaBlock}
            ${reshareBlock}
            ${mentionsLine}
            ${tagsLine}
            ${enableActions ? `<div class="social-post__actions">
              ${renderReplyForm(post, { open: openReplyId === post.id, state, viewerHash })}
              ${!mediaHasBlocked ? renderReshareForm(post, { open: openReshareId === post.id }) : ''}
            </div>` : ''}
          </div>
        </article></li>
      `;
    })
    .join('\n');
  return `<ul class="wall-feed">${rows}</ul>`;
}

function renderSocialOnboarding({ followTypeFilter, createHref, canManageFollows }) {
  if (followTypeFilter) {
    return `<div class="wall-feed onboarding-card">
      <h3>No updates match this follow type</h3>
      <p><a href="/social/feed" data-partial>Show all updates</a></p>
    </div>`;
  }
  return `
    <div class="wall-feed onboarding-card">
      <h3>No updates yet</h3>
      <div class="onboarding-actions">
        ${createHref ? `<a class="ghost" href="${escapeHtml(createHref)}" data-social-compose-link data-partial>Share an update</a>` : ''}
        ${canManageFollows ? '<a class="ghost" href="#social-follows" data-social-follows-link>Follow a handle</a>' : ''}
      </div>
    </div>
  `;
}

export function renderFollowList(follows, state) {
  if (!follows || follows.length === 0) {
    return renderEmptyState('You are not following anyone yet. Add a handle to tailor your wall.');
  }

  return follows
    .map((edge) => {
      const createdAt = formatTimestamp(edge.createdAt);
      return `
        <div class="list-row">
          <div class="topic-byline">
            ${renderActorAvatar(state, edge.targetHash, { size: 'sm' })}
            ${renderActorLabel(state, edge.targetHash)}
          </div>
          <div>
            <span class="pill ghost">${escapeHtml(edge.type)}</span>
            ${createdAt ? `<span class="muted tiny">${createdAt}</span>` : ''}
          </div>
        </div>
      `;
    })
    .join('\n');
}

function renderReplyForm(post, { open = false, state, viewerHash }) {
  const direct = post.visibility === 'direct';
  const recipient = direct && (post.authorHash === viewerHash ? post.targetHash : post.authorHash);
  const openAttr = open ? 'open' : '';
  return `
    <details class="form-toggle form-toggle--inline" ${openAttr}>
      <summary>Reply</summary>
      <form class="stack" method="post" action="/social/reply" data-enhance="social-reply">
        <input type="hidden" name="replyTo" value="${escapeHtml(post.id)}" />
        <label class="field">
          <span>Reply</span>
          <textarea name="content" rows="2" maxlength="560" required></textarea>
        </label>
        ${direct ? `<p class="muted small">Direct to ${renderActorLabel(state, recipient, { showHash: false })}</p>` : `
        <div class="form-grid">
          <label class="field">
            <span>Audience</span>
            <select name="visibility">
              <option value="public">Public</option>
              <option value="direct">Direct</option>
            </select>
          </label>
          <label class="field">
            <span>Recipient handle for direct replies</span>
            <input name="targetHandle" placeholder="@handle" maxlength="64" />
          </label>
        </div>`}
        <button class="ghost" type="submit">Send reply</button>
      </form>
    </details>
  `;
}

function renderReshare(post, options) {
  if (!post.reshare) return '';
  const author = post.reshare.authorHash ? renderActorLabel(options.state, post.reshare.authorHash)
    : escapeHtml(post.reshare.authorHandle ? `@${post.reshare.authorHandle}` : 'unknown');
  const content = escapeHtml(post.reshare.content || '');
  const created = formatTimestamp(post.reshare.createdAt);
  const mediaBlock = renderMediaAttachments(post.reshare.mediaIds || [], options);
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

function renderReshareForm(post, { open = false } = {}) {
  if (post.visibility === 'direct') return '';
  const openAttr = open ? 'open' : '';
  return `
    <details class="form-toggle form-toggle--inline" ${openAttr}>
      <summary>Reshare</summary>
      <form class="stack" method="post" action="/social/post" data-enhance="social-reshare">
        <input type="hidden" name="reshareOf" value="${escapeHtml(post.id)}" />
        <label class="field">
          <span class="muted small">Add a comment (optional)</span>
          <textarea name="content" rows="2" placeholder="Optional comment"></textarea>
        </label>
        <button class="ghost" type="submit">Reshare</button>
      </form>
    </details>
  `;
}

function renderMediaAttachments(mediaIds, { mediaById, enableActions, viewerHash }) {
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
            ${enableActions ? `<div class="cta-row">
              <a class="ghost" href="/social/media/${escapeHtml(media.id)}?view=1" target="_blank" rel="noreferrer">Request view<span class="sr-only"> (opens a new tab)</span></a>
              ${viewerHash ? renderMediaReportForm(media) : ''}
            </div>` : ''}
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
          ${enableActions ? mediaTag : '<p class="muted small">Viewing is unavailable for this session.</p>'}
          ${enableActions && viewerHash ? renderMediaReportForm(media) : ''}
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
