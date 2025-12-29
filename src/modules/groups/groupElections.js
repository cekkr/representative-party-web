import { randomUUID } from 'node:crypto';

import { persistGroupElections } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
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
  const stamped = stampLocalEntry(state, election);
  state.groupElections = [stamped, ...(state.groupElections || [])];
  await persistGroupElections(state);
  return stamped;
}

export function listElections(state, groupId) {
  return filterVisibleEntries(state.groupElections, state).filter((e) => e.groupId === groupId);
}

export async function castElectionVote({ electionId, voterHash, candidateHash, secondChoiceHash, state }) {
  const elections = state.groupElections || [];
  const election = elections.find((e) => e.id === electionId && e.status === 'open');
  if (!election) return null;
  const votes = election.votes || [];
  const filtered = votes.filter((v) => v.voterHash !== voterHash);
  const candidates = election.candidates || [];
  const normalizedSecond =
    secondChoiceHash && secondChoiceHash !== candidateHash && candidates.includes(secondChoiceHash)
      ? secondChoiceHash
      : null;
  filtered.push({
    voterHash,
    candidateHash,
    secondChoiceHash: normalizedSecond,
    castAt: new Date().toISOString(),
    validationStatus: election.validationStatus || 'validated',
  });
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
  const policy = getGroupPolicy(state, election.groupId);
  const result = resolveRankedChoiceWinner(election);
  if (!result) return null;
  return { candidateHash: result.candidateHash, mode: policy.electionMode || 'vote', method: result.method, rounds: result.rounds };
}

function resolveRankedChoiceWinner(election) {
  const candidates = (election.candidates || []).filter(Boolean);
  const votes = election.votes || [];
  if (!candidates.length || !votes.length) return null;

  let active = new Set(candidates);
  const workingVotes = votes.map((vote) => ({
    first: vote.candidateHash,
    second: vote.secondChoiceHash || null,
  }));
  let rounds = 0;

  while (active.size > 1) {
    rounds += 1;
    const counts = tallyFirstChoices(workingVotes, active);
    const total = sumCounts(counts, active);
    if (!total) break;

    const majority = Math.floor(total / 2) + 1;
    const topCandidates = findTopCandidates(counts, active);
    if (topCandidates.length === 1 && counts[topCandidates[0]] >= majority) {
      return { candidateHash: topCandidates[0], method: rounds === 1 ? 'majority' : 'ranked', rounds };
    }

    const lowestCandidates = findLowestCandidates(counts, active);
    if (lowestCandidates.length >= active.size) break;

    const lowestSet = new Set(lowestCandidates);
    for (const vote of workingVotes) {
      if (!active.has(vote.first)) {
        vote.first = null;
      }
      if (vote.first && lowestSet.has(vote.first)) {
        const fallback = vote.second;
        vote.first = fallback && active.has(fallback) && !lowestSet.has(fallback) ? fallback : null;
      }
    }
    for (const candidate of lowestCandidates) {
      active.delete(candidate);
    }

    if (active.size === 1) {
      const [remaining] = active;
      return { candidateHash: remaining, method: 'ranked', rounds };
    }
  }

  const remaining = candidates.filter((candidate) => active.has(candidate));
  if (!remaining.length) return null;
  const tieBreak = breakTieWithSecondChoice(votes, remaining);
  if (tieBreak) {
    return { candidateHash: tieBreak, method: 'tie_break', rounds };
  }
  return { candidateHash: remaining[0], method: 'fallback', rounds };
}

function tallyFirstChoices(votes, active) {
  const counts = {};
  for (const candidate of active) {
    counts[candidate] = 0;
  }
  for (const vote of votes) {
    if (vote.first && active.has(vote.first)) {
      counts[vote.first] = (counts[vote.first] || 0) + 1;
    }
  }
  return counts;
}

function sumCounts(counts, active) {
  let total = 0;
  for (const candidate of active) {
    total += counts[candidate] || 0;
  }
  return total;
}

function findTopCandidates(counts, active) {
  let max = -1;
  const winners = [];
  for (const candidate of active) {
    const count = counts[candidate] || 0;
    if (count > max) {
      winners.length = 0;
      winners.push(candidate);
      max = count;
    } else if (count === max) {
      winners.push(candidate);
    }
  }
  return winners;
}

function findLowestCandidates(counts, active) {
  let min = Infinity;
  const losers = [];
  for (const candidate of active) {
    const count = counts[candidate] || 0;
    if (count < min) {
      losers.length = 0;
      losers.push(candidate);
      min = count;
    } else if (count === min) {
      losers.push(candidate);
    }
  }
  return losers;
}

function breakTieWithSecondChoice(votes, candidates) {
  const candidateSet = new Set(candidates);
  const counts = {};
  for (const candidate of candidates) {
    counts[candidate] = 0;
  }
  for (const vote of votes) {
    const second = vote.secondChoiceHash;
    if (second && candidateSet.has(second)) {
      counts[second] = (counts[second] || 0) + 1;
    }
  }
  const top = findTopCandidates(counts, candidateSet);
  if (top.length === 1) return top[0];
  return candidates[0];
}
