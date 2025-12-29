import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startElection, castElectionVote } from '../src/modules/groups/groupElections.js';

function buildState() {
  return {
    groupElections: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveGroupElections: async () => {} },
  };
}

test('group elections store second choice when valid', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g1', topic: 'energy', candidates: ['c1', 'c2'], state });
  await castElectionVote({ electionId: election.id, voterHash: 'v1', candidateHash: 'c1', secondChoiceHash: 'c2', state });
  assert.equal(election.votes.length, 1);
  assert.equal(election.votes[0].secondChoiceHash, 'c2');
});

test('group elections ignore invalid second choice', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g2', topic: 'health', candidates: ['a', 'b'], state });
  await castElectionVote({ electionId: election.id, voterHash: 'v2', candidateHash: 'a', secondChoiceHash: 'a', state });
  assert.equal(election.votes[0].secondChoiceHash, null);
});
