import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTopicMerge,
  applyTopicRename,
  applyTopicSplit,
  ensureTopicPath,
  formatTopicBreadcrumb,
  resolveTopicPath,
} from '../src/modules/topics/registry.js';

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

test('applyTopicMerge redirects breadcrumb to target topic', async () => {
  const state = { topics: [] };
  const first = await ensureTopicPath(state, 'Transport', { source: 'test', persist: false });
  const second = await ensureTopicPath(state, 'Mobility', { source: 'test', persist: false });
  const merge = applyTopicMerge(state, first.topic.id, second.topic.id, { reason: 'test' });
  assert.equal(merge.updated, true);
  const breadcrumb = formatTopicBreadcrumb(state, first.topic.id);
  assert.equal(breadcrumb, 'Mobility');
});

test('applyTopicSplit creates child topics under the original', async () => {
  const state = { topics: [] };
  const base = await ensureTopicPath(state, 'Energy', { source: 'test', persist: false });
  const result = await applyTopicSplit(state, base.topic.id, {
    labels: ['Solar', 'Wind'],
    reason: 'test',
    persist: false,
  });
  assert.equal(result.created, 2);
  const solar = state.topics.find((topic) => topic.pathKey === 'energy/solar');
  const wind = state.topics.find((topic) => topic.pathKey === 'energy/wind');
  assert.ok(solar);
  assert.ok(wind);
});
