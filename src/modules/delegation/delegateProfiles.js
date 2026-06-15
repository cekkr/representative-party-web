import { sanitizeText } from '../../shared/utils/text.js';
import { filterVisibleEntries } from '../federation/replication.js';
import { findSessionByHash } from '../identity/sessions.js';
import { listGroups } from '../groups/groups.js';
import { pickWinner } from '../groups/groupElections.js';

const PUBLIC_BIO_KEYS = ['publicbio', 'public_bio', 'delegatebio', 'delegate_bio'];

// Lightweight directory of known verified people for discovery (no per-person full scans):
// incoming-delegation tallies are computed in a single pass over the delegation list.
export function listPeopleDirectory(state, { query = '' } = {}) {
  const sessions = state?.sessions ? [...state.sessions.values()] : [];
  const delegations = filterVisibleEntries(state.delegations || [], state);
  const incomingByHash = new Map();
  for (const entry of delegations) {
    if (!entry.delegateHash) continue;
    const bucket = incomingByHash.get(entry.delegateHash) || { total: 0, owners: new Set() };
    bucket.total += 1;
    if (entry.ownerHash) bucket.owners.add(entry.ownerHash);
    incomingByHash.set(entry.delegateHash, bucket);
  }

  const normalizedQuery = String(query || '').trim().toLowerCase().replace(/^@+/, '');
  const people = [];
  const seen = new Set();
  for (const session of sessions) {
    if (!session || session.status !== 'verified' || !session.pidHash) continue;
    if (seen.has(session.pidHash)) continue;
    seen.add(session.pidHash);
    const incoming = incomingByHash.get(session.pidHash) || { total: 0, owners: new Set() };
    const role = session.role || 'user';
    const handle = session.handle || '';
    if (normalizedQuery) {
      const haystack = `${handle} ${session.pidHash} ${role}`.toLowerCase();
      if (!haystack.includes(normalizedQuery)) continue;
    }
    people.push({
      hash: session.pidHash,
      handle,
      role,
      banned: Boolean(session.banned),
      incomingTotal: incoming.total,
      incomingUniqueOwners: incoming.owners.size,
      isDelegate: role === 'delegate' || incoming.total > 0,
    });
  }

  people.sort(
    (a, b) =>
      Number(b.isDelegate) - Number(a.isDelegate) ||
      b.incomingUniqueOwners - a.incomingUniqueOwners ||
      String(a.handle || a.hash).localeCompare(String(b.handle || b.hash)),
  );
  return people;
}

export function buildDelegateProfile(state, delegateHash) {
  const normalizedHash = sanitizeText(delegateHash || '', 120);
  const session = normalizedHash ? findSessionByHash(state, normalizedHash) : null;
  const handle = session?.handle || '';
  const role = session?.role || 'unknown';
  const banned = Boolean(session?.banned);

  const delegations = filterVisibleEntries(state.delegations || [], state);
  const incoming = delegations.filter((entry) => entry.delegateHash === normalizedHash);
  const outgoing = delegations.filter((entry) => entry.ownerHash === normalizedHash);
  const incomingTopics = summarizeTopics(incoming);
  const outgoingTopics = summarizeTopics(outgoing);

  const votes = filterVisibleEntries(state.votes || [], state, (vote) => vote.authorHash === normalizedHash);
  const voteSummary = summarizeVotes(votes);

  const petitions = filterVisibleEntries(state.petitions || [], state, (petition) => petition.authorHash === normalizedHash);
  const discussions = filterVisibleEntries(state.discussions || [], state, (entry) => entry.authorHash === normalizedHash);
  const socialPosts = filterVisibleEntries(state.socialPosts || [], state, (post) => post.authorHash === normalizedHash);

  const groupEndorsements = listGroupEndorsements(state, normalizedHash);
  const electionWins = listElectionWins(state, normalizedHash);

  const bio = resolvePublicBio(state, session);
  const lastActiveAt = findLatestTimestamp([
    ...votes.map((vote) => vote.createdAt),
    ...petitions.map((petition) => petition.updatedAt || petition.createdAt),
    ...discussions.map((entry) => entry.createdAt),
    ...socialPosts.map((post) => post.createdAt),
  ]);

  const uniqueOwners = countUnique(incoming, 'ownerHash');
  const deliberationScore = computeDeliberationScore({
    uniqueOwners,
    votes: voteSummary,
    petitions: petitions.length,
    discussions: discussions.length,
    groupEndorsements: groupEndorsements.length,
    electionWins: electionWins.length,
    lastActiveAt,
  });

  return {
    hash: normalizedHash,
    handle,
    role,
    banned,
    bio,
    incoming: {
      total: incoming.length,
      uniqueOwners,
      topics: incomingTopics,
    },
    outgoing: {
      total: outgoing.length,
      topics: outgoingTopics,
    },
    votes: voteSummary,
    activity: {
      petitions: petitions.length,
      discussions: discussions.length,
      socialPosts: socialPosts.length,
      lastActiveAt,
      recentPetitions: listRecentPetitions(petitions),
    },
    endorsements: {
      groups: groupEndorsements,
      elections: electionWins,
    },
    deliberationScore,
  };
}

// Transparent, advisory reputation signal blending trust, participation, deliberation, and
// endorsements, scaled down for stale delegates. Caps at 100 so the badge stays comparable.
function computeDeliberationScore({
  uniqueOwners = 0,
  votes = {},
  petitions = 0,
  discussions = 0,
  groupEndorsements = 0,
  electionWins = 0,
  lastActiveAt = null,
} = {}) {
  const components = {
    trust: uniqueOwners * 4,
    participation: (votes.total || 0) * 2,
    deliberation: discussions + petitions * 3,
    endorsement: groupEndorsements * 2 + electionWins * 5,
  };
  const raw = components.trust + components.participation + components.deliberation + components.endorsement;
  const recencyMultiplier = recencyMultiplierFor(lastActiveAt);
  const score = Math.min(100, Math.round(raw * recencyMultiplier));
  return {
    score,
    raw,
    recencyMultiplier,
    components,
    risingStar: score >= 25 && uniqueOwners <= 3,
  };
}

function recencyMultiplierFor(lastActiveAt) {
  const parsed = Date.parse(lastActiveAt || '');
  if (!Number.isFinite(parsed)) return 0.6;
  const ageDays = (Date.now() - parsed) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.85;
  if (ageDays <= 180) return 0.7;
  return 0.6;
}

function resolvePublicBio(state, session) {
  if (!session) return '';
  const attributes = findProfileAttributes(state, session) || {};
  const provider = attributes.provider || {};
  const keys = Object.keys(provider || {});
  for (const key of keys) {
    if (!PUBLIC_BIO_KEYS.includes(String(key).toLowerCase())) continue;
    const value = sanitizeText(String(provider[key] || ''), 400);
    if (value) return value;
  }
  return '';
}

function findProfileAttributes(state, session) {
  if (!state?.profileAttributes || !session) return null;
  const bySession = state.profileAttributes.find((entry) => entry.sessionId === session.id);
  if (bySession) return bySession;
  if (session.handle) {
    return state.profileAttributes.find((entry) => entry.handle === session.handle) || null;
  }
  return null;
}

function summarizeTopics(entries = []) {
  const counts = new Map();
  for (const entry of entries) {
    const topic = String(entry.topic || 'general');
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function summarizeVotes(votes = []) {
  const summary = { total: votes.length, yes: 0, no: 0, abstain: 0, auto: 0 };
  for (const vote of votes) {
    const choice = String(vote.choice || '').toLowerCase();
    if (choice === 'yes') summary.yes += 1;
    else if (choice === 'no') summary.no += 1;
    else if (choice === 'auto') summary.auto += 1;
    else summary.abstain += 1;
  }
  return summary;
}

function listGroupEndorsements(state, delegateHash) {
  const groups = listGroups(state);
  const endorsements = [];
  for (const group of groups) {
    for (const delegate of group.delegates || []) {
      if (delegate.delegateHash !== delegateHash) continue;
      endorsements.push({
        groupId: group.id,
        groupName: group.name || group.id,
        topic: delegate.topic || 'general',
        priority: Number(delegate.priority) || 0,
        provider: delegate.provider || 'local',
        updatedAt: delegate.updatedAt || null,
      });
    }
  }
  return endorsements.sort((a, b) => b.priority - a.priority || a.groupName.localeCompare(b.groupName));
}

function listElectionWins(state, delegateHash) {
  const elections = filterVisibleEntries(state.groupElections || [], state, (entry) => entry.status === 'closed');
  const wins = [];
  for (const election of elections) {
    const winner = pickWinner(election, state);
    if (!winner || winner.candidateHash !== delegateHash) continue;
    wins.push({
      groupId: election.groupId,
      topic: election.topic || 'general',
      method: winner.method,
      rounds: winner.rounds,
      closedAt: election.closedAt || election.createdAt || null,
    });
  }
  return wins.sort((a, b) => compareTimestamp(b.closedAt, a.closedAt));
}

function listRecentPetitions(petitions = []) {
  return petitions
    .slice()
    .sort((a, b) => compareTimestamp(b.updatedAt || b.createdAt, a.updatedAt || a.createdAt))
    .slice(0, 5)
    .map((petition) => ({
      id: petition.id,
      title: petition.title,
      status: petition.status || 'draft',
      updatedAt: petition.updatedAt || petition.createdAt,
    }));
}

function countUnique(entries = [], key) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.[key]) continue;
    seen.add(entry[key]);
  }
  return seen.size;
}

function findLatestTimestamp(values = []) {
  let latest = null;
  let latestTime = 0;
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) continue;
    if (parsed > latestTime) {
      latestTime = parsed;
      latest = new Date(parsed).toISOString();
    }
  }
  return latest;
}

function compareTimestamp(left, right) {
  const leftTime = Date.parse(left || '');
  const rightTime = Date.parse(right || '');
  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
  if (!Number.isFinite(leftTime)) return 1;
  if (!Number.isFinite(rightTime)) return -1;
  return leftTime - rightTime;
}
