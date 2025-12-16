import { randomUUID } from 'node:crypto';

import { persistNotifications } from '../../infra/persistence/storage.js';

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
  state.notifications.unshift(entry);
  await persistNotifications(state);
}

export function listNotificationsForCitizen(state, citizen) {
  if (!citizen || !citizen.pidHash) return [];
  return (state.notifications || []).filter((n) => n.recipientHash === citizen.pidHash || n.recipientHash === 'broadcast');
}

export async function markAllRead(state, citizen) {
  if (!citizen || !citizen.pidHash) return;
  let changed = false;
  state.notifications = (state.notifications || []).map((n) => {
    if ((n.recipientHash === citizen.pidHash || n.recipientHash === 'broadcast') && !n.read) {
      changed = true;
      return { ...n, read: true };
    }
    return n;
  });
  if (changed) {
    await persistNotifications(state);
  }
}
