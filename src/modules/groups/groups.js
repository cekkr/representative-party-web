import { randomUUID } from 'node:crypto';

import { persistGroups } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { pickWinner } from './groupElections.js';
import { getGroupPolicy } from './groupPolicy.js';
import { buildTopicMatchKeys, topicMatchRank } from '../topics/topicMatch.js';
import { getGroupDepth } from './groupTree.js';

export function listGroups(state) {
  return filterVisibleEntries(state.groups, state);
}

export function findGroupById(state, groupId) {
  if (!groupId) return null;
  return (state.groups || []).find((group) => group.id === groupId) || null;
}

export function getGroupMemberRole(group, memberHash) {
  if (!group || !memberHash) return null;
  const roleEntry = (group.roles || []).find((entry) => entry.hash === memberHash);
  if (roleEntry) return roleEntry.role || 'member';
  return (group.members || []).includes(memberHash) ? 'member' : null;
}

export function isGroupMember(group, memberHash) {
  return Boolean(getGroupMemberRole(group, memberHash));
}

export function isGroupAdmin(group, memberHash) {
  return getGroupMemberRole(group, memberHash) === 'admin';
}

export async function createGroup({ name, description, topics, creatorHash, parentId = null, state }) {
  const group = {
    id: randomUUID(),
    name,
    description,
    parentId: parentId || null,
    topics: topics || [],
    members: creatorHash ? [creatorHash] : [],
    roles: creatorHash ? [{ hash: creatorHash, role: 'admin', joinedAt: new Date().toISOString() }] : [],
    delegates: [],
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, group);
  state.groups.unshift(stamped);
  await persistGroups(state);
  return stamped;
}

// Declared categories the group discusses. Members use these to find who to delegate for a
// category, so they are stored as real topic labels rather than free-text tags.
export async function setGroupTopics({ groupId, topics, state }) {
  const group = findGroupById(state, groupId);
  if (!group) return null;
  group.topics = Array.isArray(topics) ? topics : [];
  group.updatedAt = new Date().toISOString();
  await persistGroups(state);
  return group;
}

export function getGroupRoles(group) {
  return group.roles || [];
}

export async function joinGroup({ groupId, person, state }) {
  const group = findGroupById(state, groupId);
  if (!group || !person?.pidHash) return null;
  let changed = false;
  if (!group.members.includes(person.pidHash)) {
    group.members.push(person.pidHash);
    changed = true;
  }
  group.roles = group.roles || [];
  if (!group.roles.some((entry) => entry.hash === person.pidHash)) {
    group.roles.push({ hash: person.pidHash, role: 'member', joinedAt: new Date().toISOString() });
    changed = true;
  }
  if (changed) {
    await persistGroups(state);
  }
  return group;
}

export async function leaveGroup({ groupId, person, state }) {
  const group = findGroupById(state, groupId);
  if (!group || !person?.pidHash) return null;
  const beforeMembers = group.members.length;
  group.members = group.members.filter((m) => m !== person.pidHash);
  const beforeRoles = (group.roles || []).length;
  group.roles = (group.roles || []).filter((entry) => entry.hash !== person.pidHash);
  if (beforeMembers !== group.members.length || beforeRoles !== group.roles.length) {
    await persistGroups(state);
  }
  return group;
}

export async function setGroupDelegate({ groupId, topic, delegateHash, priority, provider, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group) return null;
  const topicKey = (topic || 'general').toLowerCase();
  const delegates = group.delegates || [];
  const filtered = delegates.filter((entry) => entry.topic !== topicKey);
  filtered.push({
    topic: topicKey,
    delegateHash,
    priority: Number(priority) || 0,
    provider: provider || 'local',
    updatedAt: new Date().toISOString(),
    votes: (group.votes || {})[topicKey] || { policy: 'priority' },
  });
  group.delegates = filtered;
  await persistGroups(state);
  return group;
}

export function recommendDelegationForPerson(person, topic, state, { matchKeys } = {}) {
  if (!person?.pidHash) return { suggestions: [], conflict: false };
  const topicKey = normalizeTopicKey(topic);
  // A group cachet set on a parent category should cover its subcategories, narrowest first,
  // with `general` as the outermost fallback — the same rule personal delegations follow.
  const keys = matchKeys || buildTopicMatchKeys(topic);
  const groups = filterVisibleEntries(state.groups, state).filter((g) => g.members?.includes(person.pidHash));
  const suggestions = [];
  for (const group of groups) {
    const policy = getGroupPolicy(state, group.id);
    const electionMode = policy.electionMode || 'priority';
    const electionWinner = electionMode === 'vote' ? findLatestElectionWinner(state, group, topicKey, keys) : null;
    const match = electionWinner || findBestGroupDelegate(group.delegates, keys);
    if (!match) continue;
    suggestions.push({
      groupId: group.id,
      groupName: group.name || '',
      // How deep the group sits in the branch tree. A think tank inside a party is a
      // narrower expression of the same membership than the party itself, so at equal
      // priority its cachet answers first instead of the tie being arbitrary.
      groupDepth: getGroupDepth(state, group),
      delegateHash: match.delegateHash,
      priority: Number(match.priority) || 0,
      provider: match.provider || 'local',
      conflictRule: policy.conflictRule || 'highest_priority',
      electionMode,
      electionId: match.electionId || null,
      electionMethod: match.electionMethod || null,
    });
  }
  if (!suggestions.length) return { suggestions, conflict: false };
  suggestions.sort((a, b) => b.priority - a.priority || b.groupDepth - a.groupDepth);
  const topPriority = suggestions[0].priority;
  const top = suggestions.filter((s) => s.priority === topPriority);
  // Branch depth breaks a tie the priority rule leaves open; it never overrides an explicit
  // priority, and it only silences a conflict when the deeper group is unambiguously one
  // group. Two branches at the same depth disagreeing is still a real conflict to surface.
  const deepest = Math.max(...top.map((s) => s.groupDepth));
  const deepestSet = top.filter((s) => s.groupDepth === deepest);
  const decisive = new Set(deepestSet.map((s) => s.delegateHash)).size === 1 ? deepestSet : top;
  const conflict = new Set(decisive.map((s) => s.delegateHash)).size > 1;
  const conflictRule = top.some((s) => s.conflictRule === 'prompt_user') ? 'prompt_user' : 'highest_priority';
  const chosen = conflict && conflictRule === 'prompt_user' ? null : decisive[0];
  return { suggestions, conflict, chosen, conflictRule };
}

// Narrowest group cachet that covers the topic's match keys.
function findBestGroupDelegate(delegates = [], matchKeys = []) {
  let best = null;
  let bestRank = Infinity;
  for (const entry of delegates || []) {
    const rank = topicMatchRank(entry.topic, matchKeys);
    if (rank === -1 || rank >= bestRank) continue;
    best = entry;
    bestRank = rank;
    if (rank === 0) break;
  }
  return best;
}

function findLatestElectionWinner(state, group, topicKey, matchKeys = []) {
  const elections = filterVisibleEntries(state.groupElections || [], state).filter(
    (entry) => entry.groupId === group.id && entry.status === 'closed',
  );
  if (!elections.length) return null;

  // Prefer the election held on the narrowest topic that covers this one, so a branch
  // group's subcategory election outranks the parent group's general election.
  const keys = matchKeys.length ? matchKeys : buildTopicMatchKeys(topicKey);
  let candidates = [];
  for (const key of keys) {
    candidates = elections.filter((entry) => normalizeTopicKey(entry.topic) === key);
    if (candidates.length) break;
  }
  if (!candidates.length) return null;

  const latest = candidates
    .slice()
    .sort((a, b) => compareTimestamp(b.closedAt || b.createdAt, a.closedAt || a.createdAt))[0];
  if (!latest) return null;

  const winner = pickWinner(latest, state);
  if (!winner) return null;
  return {
    delegateHash: winner.candidateHash,
    provider: 'group-election',
    priority: 10,
    electionId: latest.id,
    electionMethod: winner.method,
    electionClosedAt: latest.closedAt || latest.createdAt || null,
    electionTopic: latest.topic || topicKey,
  };
}

function normalizeTopicKey(value) {
  return String(value || 'general').toLowerCase();
}

function compareTimestamp(left, right) {
  const leftTime = parseTimestamp(left);
  const rightTime = parseTimestamp(right);
  if (leftTime && rightTime) return leftTime - rightTime;
  if (leftTime && !rightTime) return 1;
  if (!leftTime && rightTime) return -1;
  return 0;
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
