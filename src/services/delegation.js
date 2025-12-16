import { persistDelegations } from '../state/storage.js';
import { recommendDelegationForCitizen } from './groups.js';

// Resolve delegation choice for a topic using stored delegations or extension hooks.
export function resolveDelegation(citizen, topic, state, { notify } = {}) {
  if (!citizen || !citizen.pidHash) return null;
  const topicKey = normalizeTopic(topic);
  const direct = (state.delegations || []).find(
    (entry) => entry.ownerHash === citizen.pidHash && entry.topic === topicKey,
  );
  if (direct) return direct;

  const extensions = state?.extensions?.active || [];
  for (const extension of extensions) {
    if (typeof extension.resolveDelegation === 'function') {
      const result = extension.resolveDelegation({ citizen, topic: topicKey, delegations: state.delegations }, state);
      if (result) return result;
    }
  }

  const groupRec = recommendDelegationForCitizen(citizen, topicKey, state);
  if (groupRec.chosen) {
    if (groupRec.conflict && typeof notify === 'function') {
      notify({
        type: 'delegation_conflict',
        recipientHash: citizen.pidHash,
        message: `Delegation conflict on topic "${topicKey}" between group suggestions.`,
      });
    }
    return {
      ownerHash: citizen.pidHash,
      delegateHash: groupRec.chosen.delegateHash,
      provider: groupRec.chosen.provider,
      topic: topicKey,
      via: 'group',
      priority: groupRec.chosen.priority,
      conflict: groupRec.conflict,
    };
  }

  return null;
}

export async function setDelegation({ citizen, topic, delegateHash, provider, state }) {
  if (!citizen || !citizen.pidHash) return;
  const topicKey = normalizeTopic(topic);
  const filtered = (state.delegations || []).filter(
    (entry) => !(entry.ownerHash === citizen.pidHash && entry.topic === topicKey),
  );
  const entry = {
    ownerHash: citizen.pidHash,
    delegateHash,
    provider: provider || 'local',
    topic: topicKey,
    createdAt: new Date().toISOString(),
  };
  filtered.unshift(entry);
  state.delegations = filtered;
  await persistDelegations(state);
}

export function normalizeTopic(topic) {
  return (topic || 'general').toLowerCase();
}
