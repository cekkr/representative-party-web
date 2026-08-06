import { getGovernanceSettings } from '../governance/constitution.js';
import { MAX_DELEGATION_CHAIN_DEPTH } from './delegation.js';

// A delegated ballot is a vote a member cast *by handing the choice to their delegate*.
// It is deliberately not a choice of its own: it stays open until the delegate votes, and
// the member can override it at any time by casting a real choice, which replaces it.
//
// Before this module a delegated vote was stored as the literal string `delegate:<hash>`,
// which no tally understood — every delegated ballot fell into the abstain bucket and stayed
// there, so delegation carried no voting power at all. Resolution happens here, at read
// time, so it stays correct as the delegate votes, changes their vote, or never votes.

export const DELEGATED_CHOICE = 'delegate';
export const DEFAULT_DELEGATE_VOTE_WINDOW_DAYS = 5;

const DAY_MS = 1000 * 60 * 60 * 24;
const DIRECT_CHOICES = new Set(['yes', 'no', 'abstain']);

// Days a delegate has to cast a ballot handed to them before it lapses. 0 disables the
// deadline: the ballot stays pending until the delegate votes or the member overrides.
export function getDelegateVoteWindowDays(state) {
  const governance = getGovernanceSettings(state);
  const days = Number(governance?.delegateVoteWindowDays);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

export function normalizeVoteChoice(value) {
  const choice = String(value || '').trim().toLowerCase();
  return DIRECT_CHOICES.has(choice) ? choice : 'abstain';
}

// Read the delegation attached to a vote, tolerating the legacy `delegate:<hash>` string so
// ledgers written before the structured shape still resolve (and still gossip) correctly.
export function readDelegatedBallot(vote) {
  if (!vote) return null;
  const choice = String(vote.choice || '').trim().toLowerCase();
  if (vote.delegate?.hash && choice === DELEGATED_CHOICE) {
    return {
      delegateHash: String(vote.delegate.hash),
      via: vote.delegate.via || 'direct',
      topic: vote.delegate.topic || null,
      delegatedAt: vote.delegate.at || vote.createdAt || null,
      deadline: vote.delegate.deadline || null,
    };
  }
  if (choice.startsWith(`${DELEGATED_CHOICE}:`)) {
    const delegateHash = choice.slice(DELEGATED_CHOICE.length + 1).trim();
    if (!delegateHash) return null;
    return {
      delegateHash,
      via: 'direct',
      topic: null,
      delegatedAt: vote.createdAt || null,
      deadline: null,
    };
  }
  return null;
}

export function isDelegatedVote(vote) {
  return Boolean(readDelegatedBallot(vote));
}

export function buildDelegatedBallot({ delegateHash, via = 'direct', topic = null, windowDays = 0, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const deadline = windowDays > 0 ? new Date(now + windowDays * DAY_MS).toISOString() : null;
  return {
    hash: String(delegateHash || ''),
    via,
    topic: topic ? String(topic) : null,
    at,
    deadline,
  };
}

// Index votes as petitionId → authorHash → vote, so chain resolution is a map lookup rather
// than a scan of the whole vote store per hop.
export function buildPetitionVoteIndex(votes = []) {
  const index = new Map();
  for (const vote of votes || []) {
    if (!vote?.petitionId) continue;
    let byAuthor = index.get(vote.petitionId);
    if (!byAuthor) {
      byAuthor = new Map();
      index.set(vote.petitionId, byAuthor);
    }
    const authorHash = vote.authorHash || 'anonymous';
    // The store keeps the newest vote per author first; keep that one.
    if (!byAuthor.has(authorHash)) byAuthor.set(authorHash, vote);
  }
  return index;
}

// Resolve what a single vote actually counts as.
//
//   direct     — the member chose yes/no/abstain themselves
//   resolved   — delegated, and the delegate (or their delegate, transitively) has voted
//   pending    — delegated, the window is still open, nobody in the chain has voted yet
//   lapsed     — delegated, the window closed with no delegate vote; counts as abstain
//   unresolved — the chain cycled or ran past the depth cap; counts as abstain
export function resolveVoteChoice(state, vote, { byAuthor = new Map(), now = Date.now() } = {}) {
  const ballot = readDelegatedBallot(vote);
  if (!ballot) {
    return { status: 'direct', choice: normalizeVoteChoice(vote?.choice), hops: 0 };
  }

  const deadline = ballot.deadline;
  const deadlineMs = deadline ? Date.parse(deadline) : NaN;
  const hasDeadline = Number.isFinite(deadlineMs);
  const expired = hasDeadline && deadlineMs <= now;
  const daysLeft = hasDeadline ? Math.max(0, Math.ceil((deadlineMs - now) / DAY_MS)) : null;
  const base = {
    delegateHash: ballot.delegateHash,
    via: ballot.via,
    topic: ballot.topic,
    delegatedAt: ballot.delegatedAt,
    deadline,
    daysLeft,
  };

  const visited = new Set([vote?.authorHash].filter(Boolean));
  let current = ballot.delegateHash;
  let hops = 0;

  while (current) {
    if (visited.has(current)) {
      return { ...base, status: 'unresolved', reason: 'cycle', choice: 'abstain', hops };
    }
    if (hops > MAX_DELEGATION_CHAIN_DEPTH) {
      return { ...base, status: 'unresolved', reason: 'depth', choice: 'abstain', hops };
    }
    visited.add(current);

    const delegateVote = byAuthor.get(current);
    if (!delegateVote) {
      return {
        ...base,
        status: expired ? 'lapsed' : 'pending',
        // A lapsed ballot counts as an abstention; a pending one counts as nothing yet and
        // is reported separately so a tally never implies a member abstained while their
        // delegate still has time to act.
        choice: expired ? 'abstain' : null,
        awaitingHash: current,
        hops,
      };
    }

    const nested = readDelegatedBallot(delegateVote);
    if (!nested) {
      return {
        ...base,
        status: 'resolved',
        choice: normalizeVoteChoice(delegateVote.choice),
        resolvedByHash: current,
        resolvedAt: delegateVote.createdAt || null,
        hops,
      };
    }
    current = nested.delegateHash;
    hops += 1;
  }

  return { ...base, status: 'unresolved', reason: 'missing_delegate', choice: 'abstain', hops };
}

// Tally every petition's votes with delegated ballots resolved. `pending` is reported apart
// from yes/no/abstain on purpose: counting an open delegated ballot as an abstention would
// misreport the outcome for as long as the delegate still has time to vote.
export function tallyVotes(state, votes = [], { now = Date.now() } = {}) {
  const index = buildPetitionVoteIndex(votes);
  const buckets = new Map();
  for (const vote of votes || []) {
    if (!vote?.petitionId) continue;
    let tally = buckets.get(vote.petitionId);
    if (!tally) {
      tally = { yes: 0, no: 0, abstain: 0, pending: 0, lapsed: 0, delegated: 0, unresolved: 0 };
      buckets.set(vote.petitionId, tally);
    }
    const byAuthor = index.get(vote.petitionId) || new Map();
    const resolution = resolveVoteChoice(state, vote, { byAuthor, now });
    if (resolution.status !== 'direct') tally.delegated += 1;
    if (resolution.status === 'pending') {
      tally.pending += 1;
      continue;
    }
    if (resolution.status === 'lapsed') tally.lapsed += 1;
    if (resolution.status === 'unresolved') tally.unresolved += 1;
    const choice = resolution.choice || 'abstain';
    if (choice === 'yes') tally.yes += 1;
    else if (choice === 'no') tally.no += 1;
    else tally.abstain += 1;
  }
  return buckets;
}

// Ballots waiting on `delegateHash` to vote — the delegate's own inbox. Only open proposals
// are listed; a ballot on a closed proposal can no longer be acted on.
export function listBallotsAwaitingDelegate(state, delegateHash, { now = Date.now(), includeLapsed = false } = {}) {
  if (!delegateHash) return [];
  const votes = state?.votes || [];
  const petitions = new Map((state?.petitions || []).map((petition) => [petition.id, petition]));
  const index = buildPetitionVoteIndex(votes);
  const rows = [];

  for (const vote of votes) {
    if (!isDelegatedVote(vote)) continue;
    const byAuthor = index.get(vote.petitionId) || new Map();
    const resolution = resolveVoteChoice(state, vote, { byAuthor, now });
    if (resolution.status !== 'pending' && !(includeLapsed && resolution.status === 'lapsed')) continue;
    // `awaitingHash` is the person the chain is actually stuck on, which is what makes this
    // an inbox rather than a list of everyone who ever named this delegate.
    if (resolution.awaitingHash !== delegateHash) continue;
    const petition = petitions.get(vote.petitionId);
    if (!petition || !isOpenForVoting(petition.status)) continue;
    rows.push({ vote, petition, resolution, ownerHash: vote.authorHash });
  }

  rows.sort(compareByDeadline);
  return rows;
}

// A member's own delegated ballots, so they can see what is riding on a delegate and
// override before the window closes.
export function listDelegatedBallotsForOwner(state, ownerHash, { now = Date.now() } = {}) {
  if (!ownerHash) return [];
  const votes = state?.votes || [];
  const petitions = new Map((state?.petitions || []).map((petition) => [petition.id, petition]));
  const index = buildPetitionVoteIndex(votes);
  const rows = [];

  for (const vote of votes) {
    if (vote.authorHash !== ownerHash || !isDelegatedVote(vote)) continue;
    const byAuthor = index.get(vote.petitionId) || new Map();
    const resolution = resolveVoteChoice(state, vote, { byAuthor, now });
    const petition = petitions.get(vote.petitionId);
    if (!petition) continue;
    rows.push({ vote, petition, resolution, open: isOpenForVoting(petition.status) });
  }

  rows.sort(compareByDeadline);
  return rows;
}

// Members whose ballot on one proposal flows through `delegateHash` — either still waiting
// on them or already resolved by them. Used to notify those members when the delegate casts
// or changes a vote, so an override is a decision they get to make in time rather than a
// surprise. Call this against the state *before* the delegate's new vote is stored: a ballot
// already resolved by the new vote would otherwise look like it always was.
export function listOwnersFollowingDelegate(state, { petitionId, delegateHash, now = Date.now() } = {}) {
  if (!petitionId || !delegateHash) return [];
  const votes = (state?.votes || []).filter((vote) => vote.petitionId === petitionId);
  const byAuthor = buildPetitionVoteIndex(votes).get(petitionId) || new Map();
  const owners = [];
  for (const vote of votes) {
    if (!isDelegatedVote(vote)) continue;
    if (vote.authorHash === delegateHash) continue;
    const resolution = resolveVoteChoice(state, vote, { byAuthor, now });
    const follows =
      (resolution.status === 'pending' && resolution.awaitingHash === delegateHash) ||
      (resolution.status === 'resolved' && resolution.resolvedByHash === delegateHash);
    if (follows) owners.push({ ownerHash: vote.authorHash, resolution });
  }
  return owners;
}

export function isOpenForVoting(status = '') {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'open' || normalized === 'vote';
}

function compareByDeadline(left, right) {
  const leftMs = Date.parse(left?.resolution?.deadline || '');
  const rightMs = Date.parse(right?.resolution?.deadline || '');
  const leftValid = Number.isFinite(leftMs);
  const rightValid = Number.isFinite(rightMs);
  if (leftValid && rightValid) return leftMs - rightMs;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}
