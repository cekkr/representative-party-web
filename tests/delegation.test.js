import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setDelegation } from '../src/modules/delegation/delegation.js';

test('delegation set logs transaction', async () => {
  const state = {
    issuer: 'local',
    delegations: [],
    transactions: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: {
      saveDelegations: async () => {},
      saveTransactions: async () => {},
    },
  };

  const person = { pidHash: 'person-1' };
  await setDelegation({ person, topic: 'general', delegateHash: 'delegate-1', provider: 'manual', state });

  assert.equal(state.delegations.length, 1);
  assert.equal(state.delegations[0].delegateHash, 'delegate-1');
  assert.ok(state.transactions.length > 0);
  const tx = state.transactions[0];
  assert.equal(tx.type, 'delegation_set');
  assert.equal(tx.payload.delegateHash, 'delegate-1');
});
