import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureTopicPath, formatTopicBreadcrumb, resolveTopicPath } from '../src/modules/topics/registry.js';

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
