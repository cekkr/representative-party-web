import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { canReadProposal, proposalHref } from '../../petitions/proposalLinks.js';
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
    const proposal = proposals.get(event.petitionId);
    const hidden = event.petitionId && !proposal;
    const message = hidden ? 'The proposal is unavailable from this inbox.' : event.message;
    const view = /comment|mention/.test(event.type) ? 'discussion' : /ballot|^vote/.test(event.type) ? 'ballot' : 'overview';
    const createdAt = formatTimestamp(event.createdAt);
    const expiresAt = formatTimestamp(event.expiresAt);
    return `
      <li class="discussion stack notification-row">
        <div class="discussion__meta">
          <strong>${escapeHtml(humanizeNotificationType(event.type))}</strong>
          ${event.read ? '' : '<span class="pill">Unread</span>'}
          ${createdAt ? `<time class="muted small" datetime="${escapeHtml(event.createdAt)}">${escapeHtml(createdAt)}</time>` : ''}
        </div>
        <p>${escapeHtml(message || '')}</p>
        ${proposal ? `<a href="${escapeHtml(proposalHref(proposal, { view }))}" data-partial>Open proposal</a>` : ''}
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
