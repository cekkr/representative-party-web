import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTopic } from '../src/services/classification.js';
import { resolveDelegation, setDelegation } from '../src/services/delegation.js';

test('classifyTopic falls back to general without extensions', () => {
  const topic = classifyTopic('Any text', { extensions: { active: [] } });
  assert.equal(topic, 'general');
});

test('resolveDelegation uses stored entry', async () => {
  const state = {
    delegations: [],
    extensions: { active: [] },
    store: { saveDelegations: async () => {} },
  };
  const citizen = { pidHash: 'hash-1' };
  await setDelegation({ citizen, topic: 'energy', delegateHash: 'delegate-hash', provider: 'peer', state });
  const result = resolveDelegation(citizen, 'energy', state);
  assert.equal(result.delegateHash, 'delegate-hash');
});
