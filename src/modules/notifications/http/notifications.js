import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { describeLaneScope, renderPager, resolveTopicBreadcrumb } from '../../../interfaces/http/views/shared.js';
import { canReadProposal, proposalHref, resolveProposalScope } from '../../petitions/proposalLinks.js';
import { discussionHref, findDiscussionRecord } from '../../discussion/discussionLinks.js';
import { findGroupById } from '../../groups/groups.js';
import { groupHref } from '../../groups/http/groupView.js';
import { formatGroupLineage } from '../../groups/groupTree.js';
import { isModuleEnabled } from '../../circle/modules.js';
import { findReadableSocialPost, socialPostHref } from '../../social/socialLinks.js';
import { getPerson } from '../../identity/person.js';
import { listNotificationsForPerson, markAllRead } from '../../messaging/notifications.js';
import { resolveNotificationPreferences } from '../../messaging/outbound.js';
import { persistProfileAttributes } from '../../../infra/persistence/storage.js';
import { upsertProviderAttributes } from '../../structure/structureManager.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

export async function renderNotifications({ req, res, state, wantsPartial, url }) {
  const person = getPerson(req, state);
  const notifications = listNotificationsForPerson(state, person);
  const page = paginate(notifications, { page: parsePage(url?.searchParams.get('page')) });
  const unread = notifications.filter((notification) => !notification.read).length;
  const preferencePanel = renderPreferencesPanel(state, person);
  const html = await renderPage(
    'notifications',
    {
      notifications: renderNotificationList(page.items, state, person),
      notificationsPager: renderPager(page, { baseHref: '/notifications', label: 'alerts' }),
      unreadLabel: `${unread} unread`,
      pageNumber: page.page,
      markReadHidden: unread ? '' : 'hidden',
      person,
      personHandle: resolvePersonHandle(person),
      preferencesPanel: preferencePanel,
    },
    { wantsPartial, title: 'Notifications', state },
  );
  return sendHtml(res, html);
}

export async function markNotificationsRead({ req, res, state }) {
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const page = parsePage(body.page);
  await markAllRead(state, person);
  return sendRedirect(res, page > 1 ? `/notifications?page=${page}` : '/notifications');
}

export async function updateNotificationPreferences({ req, res, state }) {
  const person = getPerson(req, state);
  if (!person?.sessionId) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to update preferences.' });
  }
  const body = await readRequestBody(req);
  const notifyProposalComments = parseBoolean(body.notifyProposalComments, false);
  upsertProviderAttributes(state, {
    sessionId: person.sessionId,
    handle: person.handle,
    attributes: { notifyProposalComments },
  });
  await persistProfileAttributes(state);
  return sendRedirect(res, '/notifications');
}

const NOTIFICATION_TYPE_LABELS = {
  delegation_clear: 'Delegation cleared',
  delegation_conflict: 'Delegation conflict',
  delegation_renew: 'Delegation renewed',
  delegation_set: 'Delegation set',
  forum_comment: 'Forum comment',
  petition_comment: 'Proposal comment',
  petition_comment_mention: 'Mention in a proposal',
  petition_created: 'Proposal created',
  petition_drafted: 'Proposal drafted',
  petition_quorum: 'Proposal reached quorum',
  petition_revision: 'Proposal revised',
  petition_signed: 'Proposal signed',
  petition_status: 'Proposal status changed',
  social_follow: 'New follower',
  social_unfollow: 'Unfollowed',
  social_mention: 'You were mentioned',
  social_media_block: 'Media blocked',
  social_media_report: 'Media reported',
  social_media_upload: 'Media uploaded',
  social_media_view: 'Media viewed',
  social_media_view_request: 'Media view request',
  group_create: 'Group created',
  group_created: 'Group created',
  group_delegate: 'Group delegate set',
  group_delegate_set: 'Group delegate set',
  vote_recorded: 'Vote recorded',
  delegated_ballot_received: 'A ballot was delegated to you',
  delegated_ballot_resolved: 'Your delegate voted',
  promotion_requested: 'Request to move an item up',
  promotion_approved: 'Your promotion request was approved',
  promotion_declined: 'Your promotion request was declined',
  petition_promoted: 'Proposal moved up a level',
};

// Human-readable label for a notification event type, with a Title Case fallback so new
// event types stay legible instead of leaking machine identifiers like "petition_created".
export function humanizeNotificationType(type = '') {
  const key = String(type || '').toLowerCase();
  if (NOTIFICATION_TYPE_LABELS[key]) return NOTIFICATION_TYPE_LABELS[key];
  if (!key) return 'Notification';
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Resolve the record a notification points at, through the same gate a direct
// read of that record uses. A source the viewer can no longer open keeps the
// event readable but withholds its message details, scope, and link.
//
// `context` names the record and where it lives (title, lane, topic) so a row
// says which proposal or group it is about before the member opens it. It is
// built only from a source that passed the gate.
function resolveNotificationSource(event, state, person, proposals) {
  if (event.petitionId) {
    const proposal = proposals.get(event.petitionId);
    if (!proposal) return { hidden: true, noun: 'proposal' };
    const view = /comment|mention/.test(event.type) ? 'discussion' : /ballot|^vote/.test(event.type) ? 'ballot' : 'overview';
    return {
      href: proposalHref(proposal, { view }),
      label: 'Open proposal',
      context: [
        quoteTitle(proposal.title),
        describeLaneScope(resolveProposalScope(state, person, proposal)),
        resolveTopicBreadcrumb(proposal, state),
      ],
    };
  }
  if (event.discussionId) {
    const record = findDiscussionRecord(state, person, event.discussionId);
    if (!record) return { hidden: true, noun: 'contribution' };
    return {
      href: discussionHref({ groupId: record.scope.groupId ?? null, post: record.entry.id }),
      label: 'Open contribution',
      context: [
        quoteTitle(excerpt(record.entry.content, 72)),
        describeLaneScope(record.scope),
        resolveTopicBreadcrumb(record.entry, state),
      ],
    };
  }
  if (event.groupId) {
    const group = isModuleEnabled(state, 'groups') ? findGroupById(state, event.groupId) : null;
    if (!group) return { hidden: true, noun: 'group' };
    const view = event.type === 'group_delegate' || event.type === 'group_delegate_set' ? 'decisions' : 'overview';
    const lineage = formatGroupLineage(state, group);
    return {
      href: groupHref(group.id, view),
      label: 'Open group',
      context: [group.name || 'Group', lineage ? `Branch of ${lineage}` : 'Top-level group'],
    };
  }
  if (event.socialPostId) {
    const post = isModuleEnabled(state, 'social') ? findReadableSocialPost(state, person, event.socialPostId) : null;
    if (!post) return { hidden: true, noun: 'update' };
    return {
      href: socialPostHref(post.id),
      label: event.type === 'social_direct' ? 'Open conversation' : 'Open update',
      context: [
        quoteTitle(excerpt(post.content, 72)),
        post.visibility === 'direct' ? 'Direct message' : 'Public update',
      ],
    };
  }
  return {};
}

function excerpt(text, limit) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  // Break on a word when one ends reasonably close to the limit.
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function quoteTitle(text) {
  const value = String(text || '').trim();
  return value ? `“${value}”` : '';
}

// The first part names the record. Older messages already quote it, so it is
// left out then rather than said twice; the lane and topic still follow.
function renderNotificationContext(context = [], message = '') {
  const [named, ...scope] = context;
  const bare = String(named || '').replace(/^“|”$/g, '').replace(/…$/, '');
  const parts = [bare && !String(message || '').includes(bare) ? named : '', ...scope].filter(Boolean);
  if (!parts.length) return '';
  if (!(bare && parts[0] === named)) {
    return `<p class="notification-scope muted small">${parts.map(escapeHtml).join(' · ')}</p>`;
  }
  const [title, ...rest] = parts;
  return `<p class="notification-scope muted small"><span class="notification-scope__title">${escapeHtml(title)}</span>${rest.map((part) => ` · ${escapeHtml(part)}`).join('')}</p>`;
}

function renderNotificationList(list, state, person) {
  if (!list.length) return '<p class="muted">No notifications yet.</p>';
  const proposalIds = new Set(list.map((event) => event.petitionId).filter(Boolean));
  const proposals = new Map();
  if (proposalIds.size) {
    for (const proposal of state.petitions || []) {
      if (proposalIds.has(proposal.id) && canReadProposal(state, person, proposal)) {
        proposals.set(proposal.id, proposal);
      }
    }
  }
  const rows = list.map((event) => {
    const source = resolveNotificationSource(event, state, person, proposals);
    const message = source.hidden ? `The ${source.noun} is unavailable from this inbox.` : event.message;
    const createdAt = formatTimestamp(event.createdAt);
    const expiresAt = formatTimestamp(event.expiresAt);
    return `
      <li class="discussion stack notification-row${event.read ? '' : ' notification-row--unread'}">
        <div class="discussion__meta">
          <strong>${escapeHtml(humanizeNotificationType(event.type))}</strong>
          ${event.read ? '' : '<span class="pill">Unread</span>'}
          ${createdAt ? `<time class="muted small" datetime="${escapeHtml(event.createdAt)}">${escapeHtml(createdAt)}</time>` : ''}
        </div>
        ${source.hidden ? '' : renderNotificationContext(source.context, message)}
        <p>${escapeHtml(message || '')}</p>
        ${source.href ? `<a href="${escapeHtml(source.href)}" data-partial>${escapeHtml(source.label)}</a>` : ''}
        ${expiresAt ? `<p class="muted small">Expires ${escapeHtml(expiresAt)}</p>` : ''}
      </li>
    `;
  }).join('');
  return `<ul class="discussion-list notification-list">${rows}</ul>`;
}

function renderPreferencesPanel(state, person) {
  if (!person?.sessionId) {
    return `
      <section class="panel" data-composer-section="notifications-preferences" data-section-label="Alert preferences">
        <p class="eyebrow">Preferences</p>
        <h2>Proposal comment alerts</h2>
        <p class="muted small">Verify your wallet to set notification preferences.</p>
      </section>
    `;
  }
  const prefs = resolveNotificationPreferences(state, { sessionId: person.sessionId, handle: person.handle });
  const checked = prefs.proposalComments ? 'checked' : '';
  return `
    <section class="panel" data-composer-section="notifications-preferences" data-section-label="Alert preferences">
      <p class="eyebrow">Preferences</p>
      <h2>Proposal comment alerts</h2>
      <form class="stack" method="post" action="/notifications/preferences" data-enhance="notifications">
        <label class="field checkbox">
          <input type="checkbox" name="notifyProposalComments" ${checked} />
          <span>Notify me about new comments on my proposals and @mentions</span>
        </label>
        <button class="ghost" type="submit">Save preferences</button>
      </form>
      <p class="muted small">Preferences are stored locally and can be overridden by provider policy.</p>
    </section>
  `;
}
