import { getPerson } from '../../identity/person.js';
import { listNotificationsForPerson, markAllRead } from '../../messaging/notifications.js';
import { resolveNotificationPreferences } from '../../messaging/outbound.js';
import { persistProfileAttributes } from '../../../infra/persistence/storage.js';
import { upsertProviderAttributes } from '../../structure/structureManager.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

export async function renderNotifications({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const notifications = listNotificationsForPerson(state, person);
  const preferencePanel = renderPreferencesPanel(state, person);
  const html = await renderPage(
    'notifications',
    {
      notifications: renderNotificationList(notifications),
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      preferencesPanel: preferencePanel,
    },
    { wantsPartial, title: 'Notifications', state },
  );
  return sendHtml(res, html);
}

export async function markNotificationsRead({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  await markAllRead(state, person);
  return renderNotifications({ req, res, state, wantsPartial });
}

export async function updateNotificationPreferences({ req, res, state, wantsPartial }) {
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
  return renderNotifications({ req, res, state, wantsPartial });
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

function renderNotificationList(list) {
  if (!list.length) {
    return '<p class="muted">No notifications.</p>';
  }
  return list
    .map((n) => {
      const anchorId = n.petitionId ? `petition-${n.petitionId}` : '';
      const proposalLink = anchorId ? `<a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Open proposal</a>` : '';
      const createdAt = formatTimestamp(n.createdAt);
      const expiresAt = formatTimestamp(n.expiresAt);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill" title="${escapeHtml(String(n.type || ''))}">${escapeHtml(humanizeNotificationType(n.type))}</span>
            ${createdAt ? `<span class="muted small">${createdAt}</span>` : ''}
            ${n.read ? '<span class="pill ghost">read</span>' : ''}
            ${proposalLink}
          </div>
          <p>${escapeHtml(n.message)}</p>
          ${expiresAt ? `<p class="muted small">Expires: ${expiresAt}</p>` : ''}
        </article>
      `;
    })
    .join('\n');
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
