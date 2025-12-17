import { createHash, createSign, createVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { ISSUER } from '../../config.js';
import { persistTransactions } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { getReplicationProfile } from '../federation/replication.js';

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

export function exportTransactionsEnvelope(state, { limit = 100 } = {}) {
  const profile = getReplicationProfile(state);
  const entries = listTransactions(state, { limit });
  const digestList = entries.map((t) => t.digest);
  const summary = hashPayload({ digests: digestList, issuer: state.issuer || ISSUER });
  const payload = {
    id: `transactions-${Date.now()}`,
    issuer: state.issuer || ISSUER,
    issuedAt: new Date().toISOString(),
    profile,
    summary,
    entries: entries.map((t) => ({
      id: t.id,
      type: t.type,
      petitionId: t.petitionId || null,
      actorHash: t.actorHash || null,
      digest: t.digest,
      createdAt: t.createdAt,
    })),
  };
  const signature = signPayload(payload);
  return signature ? { ...payload, signature } : payload;
}

export function verifyTransactionsEnvelope(envelope) {
  const signature = envelope?.signature;
  const publicKey = process.env.CIRCLE_PUBLIC_KEY;
  const payload = { ...envelope };
  delete payload.signature;

  if (signature && publicKey) {
    const verifier = createVerify('sha256');
    verifier.update(JSON.stringify(payload));
    verifier.end();
    const valid = verifier.verify(publicKey, signature, 'base64');
    return { valid, skipped: false, payload };
  }

  return { valid: true, skipped: true, payload };
}

function signPayload(payload) {
  const privateKey = process.env.CIRCLE_PRIVATE_KEY;
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKey, 'base64');
}
