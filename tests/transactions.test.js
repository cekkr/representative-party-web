import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateKeyPairSync } from 'node:crypto';

import {
  logTransaction,
  listTransactions,
  hashPayload,
  exportTransactionsEnvelope,
  verifyTransactionsEnvelope,
} from '../src/modules/transactions/registry.js';

test('transactions registry logs and lists validated entries', async () => {
  const state = {
    issuer: 'local',
    transactions: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveTransactions: async () => {} },
  };

  const payload = { choice: 'yes' };
  const digest = hashPayload({ type: 'vote_cast', payload, issuer: state.issuer });

  const entry = await logTransaction(state, {
    type: 'vote_cast',
    actorHash: 'person-123',
    petitionId: 'petition-1',
    payload,
  });

  assert.equal(entry.digest, digest);
  assert.equal(entry.validationStatus, 'validated');
  const listed = listTransactions(state, { type: 'vote_cast', limit: 10 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, entry.id);

  const envelope = exportTransactionsEnvelope(state, { limit: 10 });
  assert.ok(envelope.summary);
  assert.ok(Array.isArray(envelope.entries));
  assert.equal(envelope.entries.length, 1);
  assert.equal(envelope.entries[0].digest, entry.digest);
});

test('transactions export and verify with signatures', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const state = {
    issuer: 'local',
    transactions: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveTransactions: async () => {} },
  };

  const payload = { choice: 'yes' };
  await logTransaction(state, {
    type: 'vote_cast',
    actorHash: 'person-123',
    petitionId: 'petition-1',
    payload,
  });

  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  process.env.CIRCLE_PUBLIC_KEY = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  const envelope = exportTransactionsEnvelope(state, { limit: 10 });
  const result = verifyTransactionsEnvelope(envelope);

  process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
  process.env.CIRCLE_PUBLIC_KEY = prevPublic;

  assert.ok(envelope.signature, 'envelope should be signed');
  assert.equal(result.valid, true);
  assert.equal(result.payload.entries.length, 1);
});
