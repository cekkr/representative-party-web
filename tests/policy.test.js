import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAction } from '../src/services/policy.js';

test('requires verification for posting when Circle policy demands it', () => {
  const state = buildState({ requireVerification: true });
  const decision = evaluateAction(state, null, 'post');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'verification_required');
});

test('allows guest posting when verification is disabled', () => {
  const state = buildState({ requireVerification: false });
  const decision = evaluateAction(state, null, 'post');
  assert.equal(decision.allowed, true);
  assert.equal(decision.role, 'guest');
});

test('blocks banned citizens regardless of action', () => {
  const state = buildState({ requireVerification: true });
  const citizen = { sessionId: 'sess-1', pidHash: 'hash-1', role: 'citizen', banned: true };
  const decision = evaluateAction(state, citizen, 'post');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'banned');
});

test('delegates may petition and vote once verified', () => {
  const state = buildState({ requireVerification: true });
  const delegate = { sessionId: 'sess-2', pidHash: 'hash-2', role: 'delegate', banned: false };
  assert.equal(evaluateAction(state, delegate, 'petition').allowed, true);
  assert.equal(evaluateAction(state, delegate, 'vote').allowed, true);
});

test('extensions can tighten action rules', () => {
  const extension = {
    id: 'tighten',
    extendActionRules: (rules) => ({
      ...rules,
      petition: { ...rules.petition, minRole: 'delegate' },
    }),
  };
  const state = buildState({ requireVerification: true }, { active: [extension] });
  const citizen = { sessionId: 'sess-3', pidHash: 'hash-3', role: 'citizen', banned: false };
  const delegate = { sessionId: 'sess-4', pidHash: 'hash-4', role: 'delegate', banned: false };
  const decisionCitizen = evaluateAction(state, citizen, 'petition');
  const decisionDelegate = evaluateAction(state, delegate, 'petition');
  assert.equal(decisionCitizen.allowed, false);
  assert.equal(decisionDelegate.allowed, true);
});

function buildState(settings, extensions = { active: [] }) {
  return {
    settings,
    peers: new Set(),
    uniquenessLedger: new Set(),
    extensions,
  };
}
