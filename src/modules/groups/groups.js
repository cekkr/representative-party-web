import { randomUUID } from 'node:crypto';

import { persistGroups } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';

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

export async function joinGroup({ groupId, citizen, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group || !citizen?.pidHash) return null;
  if (!group.members.includes(citizen.pidHash)) {
    group.members.push(citizen.pidHash);
    group.roles = group.roles || [];
    group.roles.push({ hash: citizen.pidHash, role: 'member', joinedAt: new Date().toISOString() });
    await persistGroups(state);
  }
  return group;
}

export async function leaveGroup({ groupId, citizen, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group || !citizen?.pidHash) return null;
  group.members = group.members.filter((m) => m !== citizen.pidHash);
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

export function recommendDelegationForCitizen(citizen, topic, state) {
  if (!citizen?.pidHash) return { suggestions: [], conflict: false };
  const topicKey = (topic || 'general').toLowerCase();
  const groups = filterVisibleEntries(state.groups, state).filter((g) => g.members?.includes(citizen.pidHash));
  const suggestions = [];
  for (const group of groups) {
    const match = (group.delegates || []).find((d) => d.topic === topicKey) || (group.delegates || []).find((d) => d.topic === 'general');
    if (match) {
      suggestions.push({
        groupId: group.id,
        delegateHash: match.delegateHash,
        priority: Number(match.priority) || 0,
        provider: match.provider || 'local',
      });
    }
  }
  if (!suggestions.length) return { suggestions, conflict: false };
  suggestions.sort((a, b) => b.priority - a.priority);
  const topPriority = suggestions[0].priority;
  const top = suggestions.filter((s) => s.priority === topPriority);
  const conflict = new Set(top.map((s) => s.delegateHash)).size > 1;
  const chosen = top[0];
  return { suggestions, conflict, chosen };
}
