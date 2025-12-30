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

test('group elections store second and third choice when valid', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g1', topic: 'energy', candidates: ['c1', 'c2', 'c3'], state });
  await castElectionVote({
    electionId: election.id,
    voterHash: 'v1',
    candidateHash: 'c1',
    secondChoiceHash: 'c2',
    thirdChoiceHash: 'c3',
    state,
  });
  assert.equal(election.votes.length, 1);
  assert.equal(election.votes[0].secondChoiceHash, 'c2');
  assert.equal(election.votes[0].thirdChoiceHash, 'c3');
});

test('group elections ignore invalid secondary choices', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g2', topic: 'health', candidates: ['a', 'b', 'c'], state });
  await castElectionVote({
    electionId: election.id,
    voterHash: 'v2',
    candidateHash: 'a',
    secondChoiceHash: 'a',
    thirdChoiceHash: 'b',
    state,
  });
  assert.equal(election.votes[0].secondChoiceHash, null);
  assert.equal(election.votes[0].thirdChoiceHash, 'b');
  await castElectionVote({
    electionId: election.id,
    voterHash: 'v3',
    candidateHash: 'b',
    secondChoiceHash: 'c',
    thirdChoiceHash: 'c',
    state,
  });
  const vote = election.votes.find((entry) => entry.voterHash === 'v3');
  assert.equal(vote.secondChoiceHash, 'c');
  assert.equal(vote.thirdChoiceHash, null);
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

test('group elections resolve winner using third choice transfers', async () => {
  const state = buildState();
  const election = await startElection({ groupId: 'g4', topic: 'civic', candidates: ['a', 'b', 'c', 'd'], state });
  await castElectionVote({ electionId: election.id, voterHash: 'v1', candidateHash: 'a', secondChoiceHash: 'd', thirdChoiceHash: 'b', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v2', candidateHash: 'a', secondChoiceHash: 'd', thirdChoiceHash: 'b', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v3', candidateHash: 'b', secondChoiceHash: 'c', thirdChoiceHash: 'a', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v4', candidateHash: 'c', secondChoiceHash: 'b', thirdChoiceHash: 'a', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v5', candidateHash: 'd', secondChoiceHash: 'a', thirdChoiceHash: 'b', state });
  await castElectionVote({ electionId: election.id, voterHash: 'v6', candidateHash: 'd', secondChoiceHash: 'a', thirdChoiceHash: 'b', state });
  const winner = pickWinner(election, state);
  assert.equal(winner.candidateHash, 'a');
  assert.equal(winner.method, 'ranked');
});
