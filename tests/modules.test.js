import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeModuleSettings, resolveModuleSettings } from '../src/modules/circle/modules.js';

test('module defaults enable optional modules', () => {
  const resolved = resolveModuleSettings({ settings: {} });
  assert.equal(resolved.petitions, true);
  assert.equal(resolved.votes, true);
  assert.equal(resolved.delegation, true);
  assert.equal(resolved.groups, true);
});

test('module dependencies disable dependent modules', () => {
  const normalized = normalizeModuleSettings({ petitions: false, votes: true, delegation: false, groups: true });
  assert.equal(normalized.petitions, false);
  assert.equal(normalized.votes, false);
  assert.equal(normalized.delegation, false);
  assert.equal(normalized.groups, false);
});
