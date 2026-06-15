import { persistDelegations } from '../../infra/persistence/storage.js';
import { logTransaction } from '../transactions/registry.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { recommendDelegationForPerson } from '../groups/groups.js';
import { findSessionByHash } from '../identity/sessions.js';

// Cap how far a liquid-delegation chain is followed to bound work and guard runaway chains.
export const MAX_DELEGATION_CHAIN_DEPTH = 8;

// Resolve the first delegation hop for a topic using stored delegations, extensions, or group recs.
function resolveFirstHop(person, topicKey, state, { notify } = {}) {
  const delegations = filterVisibleEntries(state.delegations || [], state);
  const direct = delegations.find(
    (entry) => entry.ownerHash === person.pidHash && entry.topic === topicKey,
  );
  if (direct) return { ...direct, via: direct.via || 'direct' };

  const extensions = state?.extensions?.active || [];
  for (const extension of extensions) {
    if (typeof extension.resolveDelegation === 'function') {
      const result = extension.resolveDelegation({ person, topic: topicKey, delegations: state.delegations }, state);
      if (result) return { ...result, via: result.via || 'extension' };
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

// Follow direct (manual) delegations transitively from a starting delegate (liquid democracy).
// Group/extension recommendations resolve the first hop only; subsequent hops follow explicit
// per-topic delegations so the chain reflects choices delegates made for themselves.
function followDelegationChain({ state, startOwnerHash, firstDelegateHash, topicKey }) {
  const delegations = filterVisibleEntries(state.delegations || [], state);
  const byOwner = new Map();
  for (const entry of delegations) {
    if (entry.topic !== topicKey || !entry.ownerHash || !entry.delegateHash) continue;
    if (!byOwner.has(entry.ownerHash)) byOwner.set(entry.ownerHash, entry);
  }

  const visited = new Set([startOwnerHash, firstDelegateHash]);
  const hops = [];
  let current = firstDelegateHash;
  let truncated = false;
  let cycle = false;
  let blockedBanned = false;

  while (true) {
    const next = byOwner.get(current);
    if (!next) break;
    const target = next.delegateHash;
    if (visited.has(target)) {
      cycle = true;
      break;
    }
    const session = findSessionByHash(state, target);
    if (session?.banned) {
      blockedBanned = true;
      break;
    }
    if (hops.length >= MAX_DELEGATION_CHAIN_DEPTH) {
      truncated = true;
      break;
    }
    hops.push({ from: current, to: target, via: next.via || 'direct', provider: next.provider || 'manual' });
    visited.add(target);
    current = target;
  }

  return { terminal: current, hops, truncated, cycle, blockedBanned };
}

// Resolve delegation for a topic, following the liquid chain to its terminal delegate.
export function resolveDelegation(person, topic, state, { notify } = {}) {
  if (!person || !person.pidHash) return null;
  const topicKey = normalizeTopic(topic);
  const first = resolveFirstHop(person, topicKey, state, { notify });
  if (!first || !first.delegateHash) return first;

  const chain = followDelegationChain({
    state,
    startOwnerHash: person.pidHash,
    firstDelegateHash: first.delegateHash,
    topicKey,
  });

  return {
    ...first,
    immediateDelegateHash: first.delegateHash,
    delegateHash: chain.terminal,
    transitive: chain.hops.length > 0,
    hops: chain.hops,
    chainTruncated: chain.truncated,
    chainCycle: chain.cycle,
    chainBlockedBanned: chain.blockedBanned,
  };
}

// Build a human-readable resolution path (owner → … → terminal) for chain visualization.
export function buildDelegationChain(state, ownerHash, topic) {
  if (!ownerHash) return null;
  const topicKey = normalizeTopic(topic);
  const resolved = resolveDelegation({ pidHash: ownerHash }, topicKey, state);
  if (!resolved || !resolved.delegateHash) return null;
  const path = [ownerHash, resolved.immediateDelegateHash || resolved.delegateHash];
  for (const hop of resolved.hops || []) {
    path.push(hop.to);
  }
  return {
    topic: topicKey,
    ownerHash,
    via: resolved.via || 'direct',
    terminal: resolved.delegateHash,
    immediateDelegateHash: resolved.immediateDelegateHash || resolved.delegateHash,
    transitive: Boolean(resolved.transitive),
    hops: resolved.hops || [],
    path: dedupePath(path),
    truncated: Boolean(resolved.chainTruncated),
    cycle: Boolean(resolved.chainCycle),
    blockedBanned: Boolean(resolved.chainBlockedBanned),
    conflict: Boolean(resolved.conflict),
  };
}

function dedupePath(path = []) {
  const output = [];
  for (const hash of path) {
    if (!hash) continue;
    if (output[output.length - 1] === hash) continue;
    output.push(hash);
  }
  return output;
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
