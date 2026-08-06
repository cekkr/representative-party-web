import { persistGroupPolicies } from '../../infra/persistence/storage.js';
import { stampLocalEntry } from '../federation/replication.js';

export function getGroupPolicy(state, groupId) {
  const found = (state.groupPolicies || []).find((p) => p.groupId === groupId);
  const defaults = state?.settings?.groupPolicy || {};
  const base = found || {
    groupId,
    electionMode: defaults.electionMode || 'priority', // or 'vote'
    conflictRule: defaults.conflictRule || 'highest_priority', // or 'prompt_user'
    categoryWeighted: false,
  };
  // Internal lanes are opt-in per group and default off: a group is a delegation and
  // election structure first, and a cohort that only wants a delegate cachet should not
  // silently acquire an empty forum and ballot box. `lanesVisibility` decides whether the
  // lane is readable by non-members; "members" is what makes a lane genuinely internal.
  return {
    ...base,
    lanes: normalizeLanes(base.lanes),
    lanesVisibility: base.lanesVisibility === 'public' ? 'public' : 'members',
  };
}

export function normalizeLanes(lanes) {
  return {
    discussion: Boolean(lanes?.discussion),
    petitions: Boolean(lanes?.petitions),
  };
}

export function isGroupLaneEnabled(state, groupId, lane) {
  if (!groupId) return true; // site level is always on; module toggles gate it instead
  const policy = getGroupPolicy(state, groupId);
  return Boolean(policy.lanes?.[lane]);
}

export async function setGroupPolicy(state, policy) {
  const list = state.groupPolicies || [];
  const filtered = list.filter((p) => p.groupId !== policy.groupId);
  filtered.push(
    stampLocalEntry(state, {
      ...policy,
      lanes: normalizeLanes(policy.lanes),
      lanesVisibility: policy.lanesVisibility === 'public' ? 'public' : 'members',
    }),
  );
  state.groupPolicies = filtered;
  await persistGroupPolicies(state);
}
