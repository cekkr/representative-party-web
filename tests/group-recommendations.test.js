import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recommendDelegationForPerson } from '../src/modules/groups/groups.js';

test('group recommendations prefer latest closed election winner in vote mode', () => {
  const person = { pidHash: 'member-1' };
  const state = {
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    settings: { groupPolicy: { electionMode: 'priority', conflictRule: 'highest_priority' } },
    groupPolicies: [{ groupId: 'g1', electionMode: 'vote', conflictRule: 'highest_priority', categoryWeighted: false }],
    groups: [
      {
        id: 'g1',
        members: ['member-1'],
        delegates: [{ topic: 'energy', delegateHash: 'manual-delegate', priority: 1, provider: 'local' }],
      },
    ],
    groupElections: [
      {
        id: 'e1',
        groupId: 'g1',
        topic: 'energy',
        status: 'closed',
        candidates: ['a', 'b'],
        votes: [{ voterHash: 'v1', candidateHash: 'a' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        closedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        id: 'e2',
        groupId: 'g1',
        topic: 'energy',
        status: 'closed',
        candidates: ['a', 'b'],
        votes: [{ voterHash: 'v2', candidateHash: 'b' }],
        createdAt: '2024-01-03T00:00:00.000Z',
        closedAt: '2024-01-04T00:00:00.000Z',
      },
    ],
  };

  const rec = recommendDelegationForPerson(person, 'energy', state);
  assert.equal(rec.chosen.delegateHash, 'b');
  assert.equal(rec.chosen.provider, 'group-election');
});
