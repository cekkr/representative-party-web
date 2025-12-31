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

export async function castElectionVote({ electionId, voterHash, candidateHash, secondChoiceHash, thirdChoiceHash, state }) {
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
  const normalizedThird =
    thirdChoiceHash &&
    thirdChoiceHash !== candidateHash &&
    thirdChoiceHash !== normalizedSecond &&
    candidates.includes(thirdChoiceHash)
      ? thirdChoiceHash
      : null;
  filtered.push({
    voterHash,
    candidateHash,
    secondChoiceHash: normalizedSecond,
    thirdChoiceHash: normalizedThird,
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
  election.closedAt = new Date().toISOString();
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
  const ballots = buildRankedBallots(votes, candidates);
  let rounds = 0;

  while (active.size > 1) {
    rounds += 1;
    const counts = tallyPreferences(ballots, active);
    const total = sumCounts(counts, active);
    if (!total) break;

    const majority = Math.floor(total / 2) + 1;
    const topCandidates = findTopCandidates(counts, active);
    if (topCandidates.length === 1 && counts[topCandidates[0]] >= majority) {
      return { candidateHash: topCandidates[0], method: rounds === 1 ? 'majority' : 'ranked', rounds };
    }

    const lowestCandidates = findLowestCandidates(counts, active);
    if (lowestCandidates.length >= active.size) break;

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
  const tieBreak = breakTieWithPreferences(ballots, remaining);
  if (tieBreak) {
    return { candidateHash: tieBreak, method: 'tie_break', rounds };
  }
  return { candidateHash: remaining[0], method: 'fallback', rounds };
}

function buildRankedBallots(votes, candidates) {
  const candidateSet = new Set(candidates);
  return (votes || [])
    .map((vote) => {
      const seen = new Set();
      const ranked = [];
      for (const choice of [vote.candidateHash, vote.secondChoiceHash, vote.thirdChoiceHash]) {
        if (!choice || !candidateSet.has(choice) || seen.has(choice)) continue;
        seen.add(choice);
        ranked.push(choice);
      }
      return ranked;
    })
    .filter((ranked) => ranked.length > 0);
}

function tallyPreferences(ballots, active) {
  const counts = {};
  for (const candidate of active) {
    counts[candidate] = 0;
  }
  for (const ballot of ballots) {
    const choice = pickActiveChoice(ballot, active);
    if (choice) {
      counts[choice] = (counts[choice] || 0) + 1;
    }
  }
  return counts;
}

function pickActiveChoice(ballot, active) {
  for (const choice of ballot) {
    if (active.has(choice)) return choice;
  }
  return null;
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

function breakTieWithPreferences(ballots, candidates) {
  const candidateSet = new Set(candidates);
  const scores = {};
  for (const candidate of candidates) {
    scores[candidate] = 0;
  }
  for (const ballot of ballots) {
    for (let idx = 0; idx < ballot.length; idx += 1) {
      const choice = ballot[idx];
      if (!candidateSet.has(choice)) continue;
      const weight = ballot.length - idx;
      scores[choice] += weight;
    }
  }
  const top = findTopCandidates(scores, candidateSet);
  if (top.length === 1) return top[0];
  return candidates[0];
}
