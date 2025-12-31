import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clearDelegation, setDelegation } from '../src/modules/delegation/delegation.js';
import { resolveDelegation } from '../src/modules/delegation/delegation.js';

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
  assert.equal(state.delegations[0].validationStatus, 'validated');
  assert.ok(state.delegations[0].issuer);
  assert.ok(state.transactions.length > 0);
  const tx = state.transactions[0];
  assert.equal(tx.type, 'delegation_set');
  assert.equal(tx.payload.delegateHash, 'delegate-1');
});

test('clearDelegation removes topic preference', async () => {
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

  const person = { pidHash: 'person-2' };
  await setDelegation({ person, topic: 'energy', delegateHash: 'delegate-2', provider: 'manual', state });
  const result = await clearDelegation({ person, topic: 'energy', state });

  assert.equal(result.removed, true);
  assert.equal(state.delegations.length, 0);
});

test('delegation conflict with prompt_user does not auto-resolve', () => {
  let notified = false;
  const state = {
    issuer: 'local',
    delegations: [],
    groupPolicies: [{ groupId: 'g1', electionMode: 'priority', conflictRule: 'prompt_user', categoryWeighted: false }],
    groups: [
      {
        id: 'g1',
        members: ['person-1'],
        delegates: [{ topic: 'general', delegateHash: 'delegate-a', priority: 10, provider: 'local' }],
        validationStatus: 'validated',
      },
      {
        id: 'g2',
        members: ['person-1'],
        delegates: [{ topic: 'general', delegateHash: 'delegate-b', priority: 10, provider: 'local' }],
        validationStatus: 'validated',
      },
    ],
    extensions: { active: [] },
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    settings: { groupPolicy: { electionMode: 'priority', conflictRule: 'highest_priority' } },
  };

  const person = { pidHash: 'person-1' };
  const result = resolveDelegation(person, 'general', state, {
    notify: () => {
      notified = true;
    },
  });

  assert.equal(result, null);
  assert.equal(notified, true);
});
