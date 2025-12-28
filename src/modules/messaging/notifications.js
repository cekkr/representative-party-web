import { randomUUID } from 'node:crypto';

import { persistNotifications } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { deliverOutbound, resolveContactChannels } from './outbound.js';

export async function createNotification(state, notification) {
  const entry = {
    id: randomUUID(),
    type: notification.type || 'info',
    recipientHash: notification.recipientHash || 'anonymous',
    petitionId: notification.petitionId || null,
    message: notification.message || '',
    expiresAt: notification.expiresAt || null,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const stamped = stampLocalEntry(state, entry);
  state.notifications.unshift(stamped);
  await persistNotifications(state);
}

export async function createNotificationWithOutbound(state, notification, contactHint = {}) {
  const contact = resolveContactChannels(state, contactHint);
  await createNotification(state, notification);
  const outbound = state.outbound || {};
  const result = await deliverOutbound(state, { contact, notification, transport: outbound });
  return { contact, outbound: result };
}

export function listNotificationsForPerson(state, person) {
  if (!person || !person.pidHash) return [];
  return filterVisibleEntries(state.notifications, state).filter((n) => n.recipientHash === person.pidHash || n.recipientHash === 'broadcast');
}

export async function markAllRead(state, person) {
  if (!person || !person.pidHash) return;
  let changed = false;
  state.notifications = (state.notifications || []).map((n) => {
    if ((n.recipientHash === person.pidHash || n.recipientHash === 'broadcast') && !n.read) {
      changed = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (changed) {
    await persistNotifications(state);
  }
}
