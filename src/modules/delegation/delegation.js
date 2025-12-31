import { persistDelegations } from '../../infra/persistence/storage.js';
import { logTransaction } from '../transactions/registry.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { recommendDelegationForPerson } from '../groups/groups.js';

// Resolve delegation choice for a topic using stored delegations or extension hooks.
export function resolveDelegation(person, topic, state, { notify } = {}) {
  if (!person || !person.pidHash) return null;
  const topicKey = normalizeTopic(topic);
  const delegations = filterVisibleEntries(state.delegations || [], state);
  const direct = delegations.find(
    (entry) => entry.ownerHash === person.pidHash && entry.topic === topicKey,
  );
  if (direct) return direct;

  const extensions = state?.extensions?.active || [];
  for (const extension of extensions) {
    if (typeof extension.resolveDelegation === 'function') {
      const result = extension.resolveDelegation({ person, topic: topicKey, delegations: state.delegations }, state);
      if (result) return result;
    }
  }

  const groupRec = recommendDelegationForPerson(person, topicKey, state);
  if (groupRec.conflict && typeof notify === 'function') {
    notify({
      type: 'delegation_conflict',
      recipientHash: person.pidHash,
      message: `Delegation conflict on topic "${topicKey}" between group suggestions.`,
    });
  }
  if (groupRec.chosen) {
    return {
      ownerHash: person.pidHash,
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

export async function chooseDelegation({ person, topic, delegateHash, state }) {
  if (!person?.pidHash) return;
  await setDelegation({ person, topic, delegateHash, provider: 'manual', state });
}

export async function setDelegation({ person, topic, delegateHash, provider, state }) {
  if (!person || !person.pidHash) return;
  const topicKey = normalizeTopic(topic);
  const filtered = (state.delegations || []).filter(
    (entry) => !(entry.ownerHash === person.pidHash && entry.topic === topicKey),
  );
  const entry = stampLocalEntry(state, {
    ownerHash: person.pidHash,
    delegateHash,
    provider: provider || 'local',
    topic: topicKey,
    createdAt: new Date().toISOString(),
  });
  filtered.unshift(entry);
  state.delegations = filtered;
  await persistDelegations(state);
  await logTransaction(state, {
    type: 'delegation_set',
    actorHash: person.pidHash,
    payload: { topic: topicKey, delegateHash, provider },
  });
}

export async function clearDelegation({ person, topic, state }) {
  if (!person?.pidHash) return { removed: false };
  const topicKey = normalizeTopic(topic);
  const before = state.delegations || [];
  const after = before.filter((entry) => !(entry.ownerHash === person.pidHash && entry.topic === topicKey));
  if (after.length === before.length) return { removed: false };
  state.delegations = after;
  await persistDelegations(state);
  await logTransaction(state, {
    type: 'delegation_clear',
    actorHash: person.pidHash,
    payload: { topic: topicKey },
  });
  return { removed: true };
}

export function listDelegationsForPerson(state, person) {
  if (!person?.pidHash) return [];
  return filterVisibleEntries(state.delegations || [], state).filter((entry) => entry.ownerHash === person.pidHash);
}

export function normalizeTopic(topic) {
  return (topic || 'general').toLowerCase();
}
