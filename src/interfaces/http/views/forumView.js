import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderActorAvatar, renderActorLabel } from './actorLabel.js';
import {
  renderEmptyState,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPager,
  renderPreviewPill,
  resolveTopicBreadcrumb,
} from './shared.js';
import { paginate } from '../../../shared/utils/pagination.js';
import { forumThreadHref } from '../../../modules/forum/threads.js';

export function renderForum(entries, state, { q = '', page = 1, postGate } = {}) {
  const threads = [];
  const replyCounts = new Map();
  for (const entry of entries) {
    if (entry.parentId) {
      replyCounts.set(entry.parentId, (replyCounts.get(entry.parentId) || 0) + 1);
    } else {
      threads.push(entry);
    }
  }
  const query = q.toLowerCase();
  const topicCache = new Map();
  const matches = q ? threads.filter((thread) =>
    [thread.title, thread.content, resolveTopicBreadcrumb(thread, state, topicCache)]
      .some((value) => String(value || '').toLowerCase().includes(query)),
  ) : threads;
  const pageInfo = paginate(matches, { page });
  return {
    forumSearchQuery: escapeHtml(q),
    forumClearSearch: q ? '<a href="/forum" data-partial>Clear search</a>' : '',
    threads: pageInfo.items.map((thread) => renderThreadRow(thread, state, {
      topic: resolveTopicBreadcrumb(thread, state, topicCache),
      href: forumThreadHref(thread.id, { q, page: pageInfo.page }),
      replyCount: replyCounts.get(thread.id) || 0,
    })).join('\n'),
    threadsEmpty: matches.length ? '' : renderEmptyState(q
      ? 'No articles match your search.'
      : postGate?.allowed ? 'No articles yet. Use New article to start a discussion.' : 'No articles yet.'),
    threadsPager: renderPager(pageInfo, { baseHref: '/forum', query: { q }, label: 'articles' }),
    forumCreateAction: postGate?.allowed
      ? '<a class="cta" href="/forum?compose=thread#forum-compose" data-partial>New article</a>'
      : '',
    forumComposeHidden: postGate?.allowed ? '' : 'hidden',
    forumPostingNotice: postGate?.allowed ? '' : escapeHtml(postGate?.message || 'Publishing is unavailable.'),
  };
}

function renderThreadRow(thread, state, { topic, href, replyCount }) {
  const content = String(thread.content || '').replace(/\s+/g, ' ').trim();
  const excerpt = content.length > 220 ? `${content.slice(0, 219).trimEnd()}…` : content;
  return `
    <li>
      <article class="topic-card forum-row" id="thread-${escapeHtml(thread.id)}">
        <div class="topic-head">
          ${renderActorAvatar(state, thread.authorHash || 'anonymous')}
          <div class="topic-info">
            <div class="topic-byline">
              <span class="topic-author">${renderActorLabel(state, thread.authorHash || 'anonymous')}</span>
              ${renderTimestamp(thread.createdAt)}
            </div>
            <h3 class="topic-title"><a href="${escapeHtml(href)}" data-partial>${escapeHtml(thread.title || 'Untitled article')}</a></h3>
            <p>${escapeHtml(excerpt)}</p>
            <footer class="topic-meta">
              <span class="topic-breadcrumbs">${escapeHtml(topic)}</span>
              ${renderPreviewPill(thread)}
              ${renderIssuerPill(thread)}
              <span class="muted small forum-row__count">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
            </footer>
          </div>
        </div>
      </article>
    </li>`;
}

export function renderForumThread(thread, comments, state, { q = '', page = 1, postGate } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const query = params.size ? `?${params}` : '';
  const ordered = comments.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  return {
    forumReturnHref: escapeHtml(`/forum${query}`),
    threadTitle: escapeHtml(thread.title || 'Untitled article'),
    threadAnchor: `thread-${escapeHtml(thread.id)}`,
    threadTopic: escapeHtml(resolveTopicBreadcrumb(thread, state)),
    threadId: escapeHtml(thread.id),
    threadByline: `
      ${renderActorAvatar(state, thread.authorHash || 'anonymous')}
      <span class="topic-author">${renderActorLabel(state, thread.authorHash || 'anonymous')}</span>
      ${renderTimestamp(thread.createdAt)}
      ${renderPreviewPill(thread)}
      ${renderIssuerPill(thread)}
    `,
    threadContent: escapeHtml(thread.content),
    threadReplies: ordered.length ? renderComments(ordered, state) : renderEmptyState('No replies yet.'),
    threadReplyCount: ordered.length,
    threadReplyAction: postGate?.allowed ? '<a class="cta" href="#forum-reply">Write a reply</a>' : '',
    threadReplyFormHidden: postGate?.allowed ? '' : 'hidden',
    threadReplyNotice: postGate?.allowed ? '' : escapeHtml(postGate?.message || 'Replying is unavailable.'),
    threadReplyPostHref: escapeHtml(`/forum/comment${query}`),
  };
}

function renderTimestamp(value) {
  const date = formatTimestamp(value);
  return date ? `<time class="topic-time muted small" datetime="${escapeHtml(new Date(value).toISOString())}">${date}</time>` : '';
}

function renderComments(comments, state) {
  return comments.map((comment) => {
    const evidenceLinks = Array.isArray(comment.evidenceLinks) ? comment.evidenceLinks : [];
    return `
      <article class="reply-card" id="reply-${escapeHtml(comment.id)}">
        ${renderActorAvatar(state, comment.authorHash || 'anonymous', { size: 'sm' })}
        <div class="reply-card__content">
          <div class="reply-card__meta">
            <span class="topic-author">${renderActorLabel(state, comment.authorHash || 'anonymous')}</span>
            ${renderTimestamp(comment.createdAt)}
            ${renderPreviewPill(comment)}
            ${renderIssuerPill(comment)}
          </div>
          <p class="reply-card__text">${escapeHtml(comment.content)}</p>
          ${renderEvidenceLinks(evidenceLinks)}
        </div>
      </article>
    `;
  }).join('\n');
}
