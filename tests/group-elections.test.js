import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startElection, castElectionVote, pickWinner } from '../src/modules/groups/groupElections.js';

function buildState() {
  return {
    groupElections: [],
    groupPolicies: [],
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

test('group elections resolve winner using second choice transfer', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g3', topic: 'transport', candidates: ['x', 'y', 'z'], state });
  await castElectionVote({ electionId: election.id, voterHash: 'v1', candidateHash: 'x', secondChoiceHash: 'y', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v2', candidateHash: 'y', secondChoiceHash: 'x', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v3', candidateHash: 'z', secondChoiceHash: 'x', state });
  const winner = pickWinner(election, state);
  assert.equal(winner.candidateHash, 'x');
  assert.ok(['ranked', 'tie_break'].includes(winner.method));
});
