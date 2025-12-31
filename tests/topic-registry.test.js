import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyTopicRename, ensureTopicPath, formatTopicBreadcrumb, resolveTopicPath } from '../src/modules/topics/registry.js';

test('ensureTopicPath creates nested topics and reuses existing path', async () => {
  const state = { topics: [] };
  const first = await ensureTopicPath(state, 'Energy / Solar', { source: 'test', persist: false });
  assert.equal(state.topics.length, 2);
  assert.ok(first.topic);
  assert.equal(first.path.length, 2);

  const second = await ensureTopicPath(state, 'Energy / Solar', { source: 'test', persist: false });
  assert.equal(state.topics.length, 2);
  assert.equal(first.topic.id, second.topic.id);

  const breadcrumb = formatTopicBreadcrumb(state, first.topic.id);
  assert.equal(breadcrumb, 'Energy / Solar');

  const resolved = resolveTopicPath(state, first.topic.id);
  assert.deepEqual(resolved.map((entry) => entry.label), ['Energy', 'Solar']);
});

test('applyTopicRename updates path keys for descendants', async () => {
  const state = { topics: [] };
  const result = await ensureTopicPath(state, 'Economy / Energy', { source: 'test', persist: false });
  const path = resolveTopicPath(state, result.topic.id);
  const parent = path[0];
  const child = path[1];

  const renamed = applyTopicRename(state, parent.id, { label: 'Finance', reason: 'test' });
  assert.equal(renamed.updated, true);
  const updatedParent = state.topics.find((topic) => topic.id === parent.id);
  const updatedChild = state.topics.find((topic) => topic.id === child.id);
  assert.equal(updatedParent.label, 'Finance');
  assert.equal(updatedParent.pathKey, 'finance');
  assert.equal(updatedChild.pathKey, 'finance/energy');
});
