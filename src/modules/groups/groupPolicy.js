import { persistGroupPolicies } from '../../infra/persistence/storage.js';
import { stampLocalEntry } from '../federation/replication.js';

export function getGroupPolicy(state, groupId) {
  const found = (state.groupPolicies || []).find((p) => p.groupId === groupId);
  return (
    found || {
      groupId,
      electionMode: 'priority', // or 'vote'
      conflictRule: 'highest_priority', // or 'prompt_user'
      categoryWeighted: false,
    }
  );
}

export async function setGroupPolicy(state, policy) {
  const list = state.groupPolicies || [];
  const filtered = list.filter((p) => p.groupId !== policy.groupId);
  filtered.push(stampLocalEntry(state, policy));
  state.groupPolicies = filtered;
  await persistGroupPolicies(state);
}
