import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_FOLLOW_TYPES,
  ensureFollowEdge,
  findSessionByHandle,
  listFollowsFor,
  normalizeFollowType,
  removeFollowEdge,
} from '../src/modules/social/followGraph.js';

test('normalizeFollowType trims, lowercases, and sanitizes follow types', () => {
  assert.equal(normalizeFollowType(' Interest '), 'interest');
  assert.equal(normalizeFollowType('alerts'), 'alerts');
  assert.equal(normalizeFollowType('custom!@#'), 'custom');
  assert.equal(normalizeFollowType(''), DEFAULT_FOLLOW_TYPES[0]);
});

test('ensureFollowEdge replaces existing follow edge for same target', () => {
  const state = { socialFollows: [], dataConfig: { mode: 'centralized', adapter: 'memory' } };
  const first = ensureFollowEdge(state, {
    followerHash: 'alice',
    targetHash: 'bob',
    targetHandle: 'bob-handle',
    type: 'circle',
  });
  assert.equal(state.socialFollows.length, 1);
  assert.equal(first.type, 'circle');

  const updated = ensureFollowEdge(state, {
    followerHash: 'alice',
    targetHash: 'bob',
    targetHandle: 'bob-handle',
    type: 'info',
  });
  assert.equal(state.socialFollows.length, 1);
  assert.equal(updated.type, 'info');
});

test('listFollowsFor supports type filtering and removeFollowEdge removes entries', () => {
  const state = { socialFollows: [], dataConfig: { mode: 'centralized', adapter: 'memory' } };
  ensureFollowEdge(state, { followerHash: 'alice', targetHash: 'bob', type: 'circle' });
  ensureFollowEdge(state, { followerHash: 'alice', targetHash: 'carol', type: 'alerts' });
  ensureFollowEdge(state, { followerHash: 'dan', targetHash: 'bob', type: 'circle' });

  const alerts = listFollowsFor(state, 'alice', 'alerts');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].targetHash, 'carol');

  assert.equal(removeFollowEdge(state, { followerHash: 'alice', targetHash: 'bob' }), true);
  assert.equal(listFollowsFor(state, 'alice').length, 1);
});

test('findSessionByHandle matches handles case-insensitively and ignores leading @', () => {
  const state = {
    sessions: new Map([
      ['s1', { id: 's1', handle: 'Alice' }],
      ['s2', { id: 's2', handle: 'bob' }],
    ]),
  };
  const found = findSessionByHandle(state, '@alice');
  assert.ok(found);
  assert.equal(found.id, 's1');
  assert.equal(findSessionByHandle(state, '@unknown'), null);
});
