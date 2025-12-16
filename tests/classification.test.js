import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTopic } from '../src/services/classification.js';
import { resolveDelegation, setDelegation } from '../src/services/delegation.js';
import { recommendDelegationForCitizen } from '../src/services/groups.js';

test('classifyTopic falls back to general without extensions', () => {
  const topic = classifyTopic('Any text', { extensions: { active: [] } });
  assert.equal(topic, 'general');
});

test('resolveDelegation uses stored entry', async () => {
  const state = {
    delegations: [],
    extensions: { active: [] },
    store: { saveDelegations: async () => {} },
    groups: [],
  };
  const citizen = { pidHash: 'hash-1' };
  await setDelegation({ citizen, topic: 'energy', delegateHash: 'delegate-hash', provider: 'peer', state });
  const result = resolveDelegation(citizen, 'energy', state);
  assert.equal(result.delegateHash, 'delegate-hash');
});

test('group recommendations provide prioritized delegate', () => {
  const citizen = { pidHash: 'me' };
  const state = {
    delegations: [],
    extensions: { active: [] },
    groups: [
      { id: 'g1', members: ['me'], delegates: [{ topic: 'energy', delegateHash: 'd1', priority: 2 }] },
      { id: 'g2', members: ['me'], delegates: [{ topic: 'energy', delegateHash: 'd2', priority: 1 }] },
    ],
  };
  const rec = recommendDelegationForCitizen(citizen, 'energy', state);
  assert.equal(rec.chosen.delegateHash, 'd1');
  assert.equal(rec.conflict, false);
});
