import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadExtensions, listAvailableExtensions } from '../src/modules/extensions/registry.js';

test('loads sample extension when enabled', async () => {
  const { active } = await loadExtensions({ list: ['sample-policy-tighten'] });
  assert.ok(active.find((ext) => ext.id === 'sample-policy-tighten'));
});

test('lists available extensions with metadata', async () => {
  const state = { settings: { extensions: ['sample-policy-tighten'] }, extensions: { active: [] } };
  state.extensions = await loadExtensions({ list: state.settings.extensions });
  const available = await listAvailableExtensions(state);
  assert.ok(Array.isArray(available));
  const sample = available.find((entry) => entry.id === 'sample-policy-tighten');
  assert.ok(sample);
  assert.equal(sample.enabled, true);
});
