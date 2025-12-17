import { createHash, randomUUID } from 'node:crypto';

import { persistTransactions } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';

export function hashPayload(payload) {
  const serialized = JSON.stringify(payload || {});
  return createHash('sha256').update(serialized).digest('hex');
}

export async function logTransaction(state, entry = {}) {
  const now = new Date().toISOString();
  const digest = hashPayload({ type: entry.type, payload: entry.payload, issuer: state.issuer });
  const stamped = stampLocalEntry(state, {
    id: entry.id || randomUUID(),
    type: entry.type || 'generic',
    actorHash: entry.actorHash || null,
    petitionId: entry.petitionId || null,
    payload: entry.payload || {},
    digest,
    validationStatus: entry.validationStatus || 'validated',
    createdAt: entry.createdAt || now,
  });
  state.transactions = [stamped, ...(state.transactions || [])].slice(0, 500);
  await persistTransactions(state);
  return stamped;
}

export function listTransactions(state, { type, limit = 50 } = {}) {
  const filtered = filterVisibleEntries(state.transactions || [], state);
  const narrowed = type ? filtered.filter((t) => t.type === type) : filtered;
  return narrowed.slice(0, limit);
}
