import { randomUUID } from 'node:crypto';

import { persistGroups } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { getGroupPolicy } from './groupPolicy.js';

export function listGroups(state) {
  return filterVisibleEntries(state.groups, state);
}

export async function createGroup({ name, description, topics, creatorHash, state }) {
  const group = {
    id: randomUUID(),
    name,
    description,
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

export function getGroupRoles(group) {
  return group.roles || [];
}

export async function joinGroup({ groupId, person, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group || !person?.pidHash) return null;
  if (!group.members.includes(person.pidHash)) {
    group.members.push(person.pidHash);
    group.roles = group.roles || [];
    group.roles.push({ hash: person.pidHash, role: 'member', joinedAt: new Date().toISOString() });
    await persistGroups(state);
  }
  return group;
}

export async function leaveGroup({ groupId, person, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group || !person?.pidHash) return null;
  group.members = group.members.filter((m) => m !== person.pidHash);
  await persistGroups(state);
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

export function recommendDelegationForPerson(person, topic, state) {
  if (!person?.pidHash) return { suggestions: [], conflict: false };
  const topicKey = (topic || 'general').toLowerCase();
  const groups = filterVisibleEntries(state.groups, state).filter((g) => g.members?.includes(person.pidHash));
  const suggestions = [];
  for (const group of groups) {
    const policy = getGroupPolicy(state, group.id);
    const match = (group.delegates || []).find((d) => d.topic === topicKey) || (group.delegates || []).find((d) => d.topic === 'general');
    if (match) {
      suggestions.push({
        groupId: group.id,
        delegateHash: match.delegateHash,
        priority: Number(match.priority) || 0,
        provider: match.provider || 'local',
        conflictRule: policy.conflictRule || 'highest_priority',
        electionMode: policy.electionMode || 'priority',
      });
    }
  }
  if (!suggestions.length) return { suggestions, conflict: false };
  suggestions.sort((a, b) => b.priority - a.priority);
  const topPriority = suggestions[0].priority;
  const top = suggestions.filter((s) => s.priority === topPriority);
  const conflict = new Set(top.map((s) => s.delegateHash)).size > 1;
  const conflictRule = top.some((s) => s.conflictRule === 'prompt_user') ? 'prompt_user' : 'highest_priority';
  const chosen = conflict && conflictRule === 'prompt_user' ? null : top[0];
  return { suggestions, conflict, chosen, conflictRule };
}
