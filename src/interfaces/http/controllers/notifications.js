import { getPerson } from '../../modules/identity/person.js';
import { listNotificationsForPerson, markAllRead } from '../../modules/messaging/notifications.js';
import { resolveNotificationPreferences } from '../../modules/messaging/outbound.js';
import { persistProfileAttributes } from '../../infra/persistence/storage.js';
import { upsertProviderAttributes } from '../../modules/structure/structureManager.js';
import { escapeHtml } from '../../shared/utils/text.js';
import { sendHtml, sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { renderPage } from '../views/templates.js';

export async function renderNotifications({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const notifications = listNotificationsForPerson(state, person);
  const preferencePanel = renderPreferencesPanel(state, person);
  const html = await renderPage(
    'notifications',
    {
      notifications: renderNotificationList(notifications),
      personHandle: person?.handle || 'Guest',
      preferencesPanel: preferencePanel,
    },
    { wantsPartial, title: 'Notifications' },
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

function renderNotificationList(list) {
  if (!list.length) {
    return '<p class="muted">No notifications.</p>';
  }
  return list
    .map((n) => {
      const anchorId = n.petitionId ? `petition-${n.petitionId}` : '';
      const proposalLink = anchorId ? `<a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Open proposal</a>` : '';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(n.type)}</span>
            <span class="muted small">${new Date(n.createdAt).toLocaleString()}</span>
            ${n.read ? '<span class="pill ghost">read</span>' : ''}
            ${proposalLink}
          </div>
          <p>${escapeHtml(n.message)}</p>
          ${n.expiresAt ? `<p class="muted small">Expires: ${new Date(n.expiresAt).toLocaleString()}</p>` : ''}
        </article>
      `;
    })
    .join('\n');
}

function renderPreferencesPanel(state, person) {
  if (!person?.sessionId) {
    return `
      <section class="panel">
        <p class="eyebrow">Preferences</p>
        <h2>Proposal comment alerts</h2>
        <p class="muted small">Verify your wallet to set notification preferences.</p>
      </section>
    `;
  }
  const prefs = resolveNotificationPreferences(state, { sessionId: person.sessionId, handle: person.handle });
  const checked = prefs.proposalComments ? 'checked' : '';
  return `
    <section class="panel">
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

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
}
