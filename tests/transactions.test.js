import { test } from 'node:test';
import assert from 'node:assert/strict';

import { logTransaction, listTransactions, hashPayload } from '../src/modules/transactions/registry.js';

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
    actorHash: 'citizen-123',
    petitionId: 'petition-1',
    payload,
  });

  assert.equal(entry.digest, digest);
  assert.equal(entry.validationStatus, 'validated');
  const listed = listTransactions(state, { type: 'vote_cast', limit: 10 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, entry.id);
});
