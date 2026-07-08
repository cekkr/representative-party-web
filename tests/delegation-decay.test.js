import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeDelegationFreshness,
  getDelegationDecayDays,
  renewDelegation,
  resolveDelegation,
} from '../src/modules/delegation/delegation.js';
import { normalizeGovernanceSettings } from '../src/modules/governance/constitution.js';

const DAY_MS = 1000 * 60 * 60 * 24;

function stateWithDecay(decayDays, delegations = []) {
  return {
    issuer: 'local',
    delegations,
    groups: [],
    groupPolicies: [],
    sessions: [],
    transactions: [],
    extensions: { active: [] },
    settings: { governance: { delegationDecayDays: decayDays } },
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveDelegations: async () => {}, saveTransactions: async () => {} },
  };
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

test('getDelegationDecayDays reads governance setting and treats <=0 as disabled', () => {
  assert.equal(getDelegationDecayDays(stateWithDecay(30)), 30);
  assert.equal(getDelegationDecayDays(stateWithDecay(0)), 0);
});

test('decay disabled keeps old delegations resolvable', () => {
  const state = stateWithDecay(0, [
    { ownerHash: 'a', delegateHash: 'b', topic: 'general', renewedAt: daysAgo(400), validationStatus: 'validated' },
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.delegateHash, 'b');
});

test('decay enabled ignores a lapsed delegation in resolution', () => {
  const state = stateWithDecay(30, [
    { ownerHash: 'a', delegateHash: 'b', topic: 'general', renewedAt: daysAgo(60), validationStatus: 'validated' },
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved, null);
});

test('decay enabled stops a transitive chain at a lapsed hop', () => {
  const state = stateWithDecay(30, [
    { ownerHash: 'a', delegateHash: 'b', topic: 'general', renewedAt: daysAgo(1), validationStatus: 'validated' },
    { ownerHash: 'b', delegateHash: 'c', topic: 'general', renewedAt: daysAgo(90), validationStatus: 'validated' },
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  // b->c lapsed, so the chain terminates at b.
  assert.equal(resolved.delegateHash, 'b');
  assert.equal(resolved.transitive, false);
});

test('renewDelegation refreshes a lapsed delegation so it resolves again', async () => {
  const state = stateWithDecay(30, [
    { ownerHash: 'a', delegateHash: 'b', topic: 'general', renewedAt: daysAgo(60), validationStatus: 'validated' },
  ]);
  assert.equal(resolveDelegation({ pidHash: 'a' }, 'general', state), null);
  const result = await renewDelegation({ person: { pidHash: 'a' }, topic: 'general', state });
  assert.equal(result.renewed, true);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.delegateHash, 'b');
  assert.ok(state.transactions.some((tx) => tx.type === 'delegation_renew'));
});

test('describeDelegationFreshness classifies active/expiring/expired', () => {
  const fresh = describeDelegationFreshness({ renewedAt: daysAgo(1) }, 30);
  assert.equal(fresh.status, 'active');
  const expiring = describeDelegationFreshness({ renewedAt: daysAgo(28) }, 30);
  assert.equal(expiring.status, 'expiring');
  const expired = describeDelegationFreshness({ renewedAt: daysAgo(40) }, 30);
  assert.equal(expired.status, 'expired');
  const off = describeDelegationFreshness({ renewedAt: daysAgo(400) }, 0);
  assert.equal(off.status, 'active');
});

test('governance normalization clamps delegationDecayDays', () => {
  assert.equal(normalizeGovernanceSettings({ delegationDecayDays: -5 }).delegationDecayDays, 0);
  assert.equal(normalizeGovernanceSettings({ delegationDecayDays: 99999 }).delegationDecayDays, 3650);
  assert.equal(normalizeGovernanceSettings({}).delegationDecayDays, 0);
});
