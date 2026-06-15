import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDelegationChain,
  resolveDelegation,
  MAX_DELEGATION_CHAIN_DEPTH,
} from '../src/modules/delegation/delegation.js';
import { buildDelegateProfile } from '../src/modules/delegation/delegateProfiles.js';

function baseState(delegations = []) {
  return {
    issuer: 'local',
    delegations,
    groups: [],
    groupPolicies: [],
    sessions: [],
    extensions: { active: [] },
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    settings: {},
  };
}

function delegation(ownerHash, delegateHash, topic = 'general') {
  return { ownerHash, delegateHash, topic, provider: 'manual', validationStatus: 'validated' };
}

test('resolveDelegation follows a transitive chain to the terminal delegate', () => {
  const state = baseState([
    delegation('a', 'b'),
    delegation('b', 'c'),
    delegation('c', 'd'),
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.delegateHash, 'd');
  assert.equal(resolved.immediateDelegateHash, 'b');
  assert.equal(resolved.transitive, true);
  assert.equal(resolved.hops.length, 2);
  assert.deepEqual(resolved.hops.map((h) => h.to), ['c', 'd']);
});

test('resolveDelegation returns the direct delegate when there is no further hop', () => {
  const state = baseState([delegation('a', 'b')]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.delegateHash, 'b');
  assert.equal(resolved.transitive, false);
  assert.equal(resolved.hops.length, 0);
});

test('resolveDelegation stops on a cycle without looping forever', () => {
  const state = baseState([
    delegation('a', 'b'),
    delegation('b', 'c'),
    delegation('c', 'a'),
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.chainCycle, true);
  assert.equal(resolved.delegateHash, 'c');
});

test('resolveDelegation stops before forwarding into a banned delegate', () => {
  const state = baseState([
    delegation('a', 'b'),
    delegation('b', 'c'),
  ]);
  state.sessions = [{ id: 's1', pidHash: 'c', handle: 'c', role: 'delegate', banned: true }];
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.chainBlockedBanned, true);
  assert.equal(resolved.delegateHash, 'b');
});

test('resolveDelegation truncates very long chains at the depth cap', () => {
  const delegations = [];
  // Build a-> n0 -> n1 -> ... longer than the cap.
  delegations.push(delegation('a', 'n0'));
  for (let i = 0; i < MAX_DELEGATION_CHAIN_DEPTH + 3; i += 1) {
    delegations.push(delegation(`n${i}`, `n${i + 1}`));
  }
  const state = baseState(delegations);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'general', state);
  assert.equal(resolved.chainTruncated, true);
  assert.equal(resolved.hops.length, MAX_DELEGATION_CHAIN_DEPTH);
});

test('topic scoping keeps unrelated chains separate', () => {
  const state = baseState([
    delegation('a', 'b', 'energy'),
    delegation('b', 'c', 'health'),
  ]);
  const resolved = resolveDelegation({ pidHash: 'a' }, 'energy', state);
  // b only forwards on "health", so the energy chain terminates at b.
  assert.equal(resolved.delegateHash, 'b');
  assert.equal(resolved.transitive, false);
});

test('buildDelegationChain returns a deduped resolution path', () => {
  const state = baseState([
    delegation('a', 'b'),
    delegation('b', 'c'),
  ]);
  const chain = buildDelegationChain(state, 'a', 'general');
  assert.deepEqual(chain.path, ['a', 'b', 'c']);
  assert.equal(chain.terminal, 'c');
  assert.equal(chain.transitive, true);
});

test('delegate profile exposes a bounded deliberation score', () => {
  const state = baseState([
    delegation('owner1', 'star'),
    delegation('owner2', 'star'),
  ]);
  state.votes = [
    { authorHash: 'star', choice: 'yes', createdAt: new Date().toISOString(), validationStatus: 'validated' },
    { authorHash: 'star', choice: 'no', createdAt: new Date().toISOString(), validationStatus: 'validated' },
  ];
  state.petitions = [];
  state.discussions = [];
  state.socialPosts = [];
  state.groupElections = [];
  state.sessions = [{ id: 's1', pidHash: 'star', handle: 'star', role: 'delegate' }];

  const profile = buildDelegateProfile(state, 'star');
  assert.ok(profile.deliberationScore);
  assert.ok(profile.deliberationScore.score >= 0 && profile.deliberationScore.score <= 100);
  assert.equal(profile.deliberationScore.components.trust, 2 * 4);
  assert.equal(profile.deliberationScore.components.participation, 2 * 2);
});
