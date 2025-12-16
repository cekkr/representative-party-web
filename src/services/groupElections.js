import { randomUUID } from 'node:crypto';

import { persistGroupElections } from '../state/storage.js';
import { getGroupPolicy } from './groupPolicy.js';

export async function startElection({ groupId, topic, candidates, state }) {
  const election = {
    id: randomUUID(),
    groupId,
    topic,
    candidates,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  state.groupElections = [election, ...(state.groupElections || [])];
  await persistGroupElections(state);
  return election;
}

export function listElections(state, groupId) {
  return (state.groupElections || []).filter((e) => e.groupId === groupId);
}

export async function castElectionVote({ electionId, voterHash, candidateHash, state }) {
  const elections = state.groupElections || [];
  const election = elections.find((e) => e.id === electionId && e.status === 'open');
  if (!election) return null;
  const votes = election.votes || [];
  const filtered = votes.filter((v) => v.voterHash !== voterHash);
  filtered.push({ voterHash, candidateHash, castAt: new Date().toISOString() });
  election.votes = filtered;
  await persistGroupElections(state);
  return election;
}

export function tallyElection(election) {
  const counts = {};
  for (const vote of election.votes || []) {
    counts[vote.candidateHash] = (counts[vote.candidateHash] || 0) + 1;
  }
  return counts;
}

export async function closeElection({ electionId, state }) {
  const election = (state.groupElections || []).find((e) => e.id === electionId);
  if (!election) return null;
  election.status = 'closed';
  await persistGroupElections(state);
  return election;
}

export function pickWinner(election, state) {
  const counts = tallyElection(election);
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [candidateHash] = entries[0];
  const policy = getGroupPolicy(state, election.groupId);
  return { candidateHash, mode: policy.electionMode || 'vote' };
}
