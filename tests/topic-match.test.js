import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTopicMatchKeys, topicMatchRank } from '../src/modules/topics/topicMatch.js';
import { resolveDelegation } from '../src/modules/delegation/delegation.js';
import { recommendDelegationForPerson } from '../src/modules/groups/groups.js';

test('match keys run from the exact path outward to general', () => {
  assert.deepEqual(buildTopicMatchKeys('Energy', ['Environment', 'Energy']), [
    'environment/energy',
    'energy',
    'environment',
    'general',
  ]);
});

test('a bare topic still yields itself and the general fallback', () => {
  assert.deepEqual(buildTopicMatchKeys('Energy'), ['energy', 'general']);
});

test('a separated topic string is parsed as a path', () => {
  assert.deepEqual(buildTopicMatchKeys('Environment / Energy'), [
    'environment/energy',
    'energy',
    'environment',
    'general',
  ]);
});

test('the leaf is appended when the path does not already end with it', () => {
  // A stale stored path plus a fresher leaf must still produce the narrower key.
  assert.equal(buildTopicMatchKeys('Solar', ['Environment'])[0], 'environment/solar');
});

test('topicMatchRank orders parent below child', () => {
  const keys = buildTopicMatchKeys('Energy', ['Environment', 'Energy']);
  assert.ok(topicMatchRank('energy', keys) < topicMatchRank('environment', keys));
  assert.equal(topicMatchRank('transport', keys), -1);
});

function stateWithDelegations(delegations) {
  return {
    delegations,
    groups: [],
    groupElections: [],
    sessions: [],
    settings: {},
  };
}

const person = { pidHash: 'owner' };

test('a delegation on a parent category covers a proposal filed in a subcategory', () => {
  const state = stateWithDelegations([{ ownerHash: 'owner', delegateHash: 'ada', topic: 'environment' }]);

  const resolved = resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] });
  assert.equal(resolved.delegateHash, 'ada');
});

test('a narrower delegation wins over the parent one', () => {
  const state = stateWithDelegations([
    { ownerHash: 'owner', delegateHash: 'ada', topic: 'environment' },
    { ownerHash: 'owner', delegateHash: 'bruno', topic: 'energy' },
  ]);

  const resolved = resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] });
  assert.equal(resolved.delegateHash, 'bruno', 'the subcategory delegation is the more specific expression');
});

test('an exact full-path delegation beats both', () => {
  const state = stateWithDelegations([
    { ownerHash: 'owner', delegateHash: 'ada', topic: 'environment' },
    { ownerHash: 'owner', delegateHash: 'bruno', topic: 'energy' },
    { ownerHash: 'owner', delegateHash: 'chiara', topic: 'environment/energy' },
  ]);

  const resolved = resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] });
  assert.equal(resolved.delegateHash, 'chiara');
});

test('general remains the outermost fallback and never beats a real match', () => {
  const state = stateWithDelegations([
    { ownerHash: 'owner', delegateHash: 'fallback', topic: 'general' },
    { ownerHash: 'owner', delegateHash: 'ada', topic: 'environment' },
  ]);

  assert.equal(
    resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] }).delegateHash,
    'ada',
  );
  assert.equal(
    resolveDelegation(person, 'Transport', state, { topicPath: ['Transport'] }).delegateHash,
    'fallback',
  );
});

test('an unrelated delegation does not leak across categories', () => {
  const state = stateWithDelegations([{ ownerHash: 'owner', delegateHash: 'ada', topic: 'transport' }]);
  assert.equal(resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] }), null);
});

test('a forwarding hop matches on the parent category too', () => {
  const state = stateWithDelegations([
    { ownerHash: 'owner', delegateHash: 'ada', topic: 'environment/energy' },
    // Ada only ever set a broad delegation, but the ballot should still forward.
    { ownerHash: 'ada', delegateHash: 'bruno', topic: 'environment' },
  ]);

  const resolved = resolveDelegation(person, 'Energy', state, { topicPath: ['Environment', 'Energy'] });
  assert.equal(resolved.delegateHash, 'bruno');
  assert.equal(resolved.transitive, true);
});

test('a group cachet on a parent category covers its subcategories', () => {
  const state = {
    delegations: [],
    groups: [
      {
        id: 'g1',
        members: ['owner'],
        delegates: [{ topic: 'environment', delegateHash: 'ada', priority: 1 }],
      },
    ],
    groupElections: [],
    sessions: [],
    settings: {},
  };

  const rec = recommendDelegationForPerson(person, 'Energy', state, {
    matchKeys: buildTopicMatchKeys('Energy', ['Environment', 'Energy']),
  });
  assert.equal(rec.chosen.delegateHash, 'ada');
});

test('a group cachet on the subcategory outranks the group general one', () => {
  const state = {
    delegations: [],
    groups: [
      {
        id: 'g1',
        members: ['owner'],
        delegates: [
          { topic: 'general', delegateHash: 'generalist', priority: 5 },
          { topic: 'energy', delegateHash: 'specialist', priority: 1 },
        ],
      },
    ],
    groupElections: [],
    sessions: [],
    settings: {},
  };

  const rec = recommendDelegationForPerson(person, 'Energy', state, {
    matchKeys: buildTopicMatchKeys('Energy', ['Environment', 'Energy']),
  });
  assert.equal(
    rec.chosen.delegateHash,
    'specialist',
    'topic specificity is resolved before the priority tie-break',
  );
});
