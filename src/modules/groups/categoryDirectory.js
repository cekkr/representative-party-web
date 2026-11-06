import { filterVisibleEntries } from '../federation/replication.js';
import { getGroupPolicy } from './groupPolicy.js';
import { getGroupDepth, listAncestorGroups } from './groupTree.js';
import { pickWinner } from './groupElections.js';
import { buildTopicMatchKeys, normalizeTopicMatchKey, topicMatchRank } from '../topics/topicMatch.js';

// Members are told delegation is topic-scoped, then given a single free-text field and left
// to guess who works on what. This inverts that: it indexes the categories groups have
// declared and, for each one, who those groups currently put forward — so "who should I
// delegate for energy?" has an answer that comes from the structure rather than from
// already knowing the answer.
//
// Everything here is advisory. A cachet is a group's suggestion, an election winner is a
// group's choice; neither binds a member, who can delegate to anyone or to nobody.

const MAX_CATEGORIES = 60;

export function buildCategoryDirectory(state, { limit = MAX_CATEGORIES } = {}) {
  const groups = filterVisibleEntries(state?.groups || [], state);
  const visibleIds = new Set(groups.map(({ id }) => id));
  const byCategory = new Map();

  const add = (rawLabel, group, entry) => {
    const key = normalizeTopicMatchKey(rawLabel);
    if (!key || key === 'general') return;
    let row = byCategory.get(key);
    if (!row) {
      row = { key, label: String(rawLabel).trim(), groups: [], delegates: [] };
      byCategory.set(key, row);
    } else if (row.label === row.label.toLowerCase() && String(rawLabel).trim() !== row.label) {
      // Cachets and elections store the normalised key; a group's declared category keeps
      // the member's casing ("Healthcare / Waiting lists"). Prefer the written form.
      row.label = String(rawLabel).trim();
    }
    if (!row.groups.some((candidate) => candidate.id === group.id)) {
      row.groups.push({
        id: group.id,
        name: group.name || 'Group',
        depth: getGroupDepth(state, group),
        lineage: listAncestorGroups(state, group)
          .filter(({ id }) => visibleIds.has(id))
          .slice()
          .reverse()
          .map((ancestor) => ancestor.name || 'Group'),
        memberCount: group.members?.length || 0,
      });
    }
    if (entry?.delegateHash) {
      // Closing an election also writes the winner as the group's cachet, so the same person
      // would be listed twice for one group. One row per (group, person); an election is the
      // stronger reason, so it names the source.
      const existing = row.delegates.find(
        (candidate) => candidate.groupId === group.id && candidate.delegateHash === entry.delegateHash,
      );
      if (existing) {
        if (entry.source === 'election') existing.source = 'election';
        existing.priority = Math.max(existing.priority, Number(entry.priority) || 0);
        return;
      }
      row.delegates.push({
        groupId: group.id,
        groupName: group.name || 'Group',
        delegateHash: entry.delegateHash,
        source: entry.source,
        priority: Number(entry.priority) || 0,
        depth: getGroupDepth(state, group),
      });
    }
  };

  for (const group of groups) {
    const policy = getGroupPolicy(state, group.id);
    const declared = Array.isArray(group.topics) ? group.topics : [];

    // A declared category counts even with nobody put forward yet — that is exactly the
    // group a member might want to join or ask.
    for (const label of declared) {
      add(label, group, null);
    }

    for (const cachet of group.delegates || []) {
      add(cachet.topic, group, { ...cachet, source: 'cachet' });
    }

    if (policy.electionMode === 'vote') {
      const elections = filterVisibleEntries(state?.groupElections || [], state).filter(
        (entry) => entry.groupId === group.id && entry.status === 'closed',
      );
      for (const election of elections) {
        const winner = pickWinner(election, state);
        if (!winner?.candidateHash) continue;
        add(election.topic, group, {
          delegateHash: winner.candidateHash,
          priority: 10,
          source: 'election',
        });
      }
    }
  }

  const rows = [...byCategory.values()];
  for (const row of rows) {
    // Deepest branch first, then priority: the most specific group that has taken a position
    // on this category is the most useful suggestion to read first.
    row.delegates.sort((a, b) => b.depth - a.depth || b.priority - a.priority);
    row.groups.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
  }
  rows.sort((a, b) => b.delegates.length - a.delegates.length || a.label.localeCompare(b.label));
  return rows.slice(0, limit);
}

// Categories a member could delegate that they have not delegated yet — the actionable
// subset of the directory for one person.
export function findCategoryGapsForPerson(state, person, delegations = []) {
  if (!person?.pidHash) return [];
  const directory = buildCategoryDirectory(state);
  const owned = delegations.filter((entry) => entry.ownerHash === person.pidHash);
  return directory.filter((row) => {
    if (!row.delegates.length) return false;
    const keys = buildTopicMatchKeys(row.label);
    return !owned.some((entry) => topicMatchRank(entry.topic, keys) !== -1);
  });
}
