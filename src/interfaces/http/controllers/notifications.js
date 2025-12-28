import { getPerson } from '../../modules/identity/person.js';
import { listNotificationsForPerson, markAllRead } from '../../modules/messaging/notifications.js';
import { escapeHtml } from '../../shared/utils/text.js';
import { sendHtml } from '../../shared/utils/http.js';
import { renderPage } from '../views/templates.js';

export async function renderNotifications({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const notifications = listNotificationsForPerson(state, person);
  const html = await renderPage(
    'notifications',
    {
      notifications: renderNotificationList(notifications),
      personHandle: person?.handle || 'Guest',
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

function renderNotificationList(list) {
  if (!list.length) {
    return '<p class="muted">No notifications.</p>';
  }
  return list
    .map((n) => {
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${n.type}</span>
            <span class="muted small">${new Date(n.createdAt).toLocaleString()}</span>
            ${n.read ? '<span class="pill ghost">read</span>' : ''}
          </div>
          <p>${escapeHtml(n.message)}</p>
          ${n.expiresAt ? `<p class="muted small">Expires: ${new Date(n.expiresAt).toLocaleString()}</p>` : ''}
        </article>
      `;
    })
    .join('\n');
}
