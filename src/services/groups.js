import { randomUUID } from 'node:crypto';

import { persistGroups } from '../state/storage.js';

export function listGroups(state) {
  return state.groups || [];
}

export async function createGroup({ name, description, topics, creatorHash, state }) {
  const group = {
    id: randomUUID(),
    name,
    description,
    topics: topics || [],
    members: creatorHash ? [creatorHash] : [],
    delegates: [],
    createdAt: new Date().toISOString(),
  };
  state.groups.unshift(group);
  await persistGroups(state);
  return group;
}

export async function joinGroup({ groupId, citizen, state }) {
  const group = (state.groups || []).find((g) => g.id === groupId);
  if (!group || !citizen?.pidHash) return null;
  if (!group.members.includes(citizen.pidHash)) {
    group.members.push(citizen.pidHash);
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
  const groups = (state.groups || []).filter((g) => g.members?.includes(citizen.pidHash));
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
