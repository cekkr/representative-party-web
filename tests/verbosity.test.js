import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVerbosityMode } from '../src/interfaces/http/views/templates.js';

test('resolveVerbosityMode prefers per-session override', () => {
  const state = { settings: { verbosityMode: 'compact' } };
  const person = { uiVerbosity: 'full' };
  assert.equal(resolveVerbosityMode({ state, person }), 'full');
});

test('resolveVerbosityMode falls back to Circle default', () => {
  const state = { settings: { verbosityMode: 'compact' } };
  assert.equal(resolveVerbosityMode({ state, person: null }), 'compact');
});

test('resolveVerbosityMode defaults to full when unset', () => {
  const state = { settings: {} };
  assert.equal(resolveVerbosityMode({ state, person: null }), 'full');
});
