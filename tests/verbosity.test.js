import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveVerbosityMode } from '../src/interfaces/http/views/templates.js';

test('resolveVerbosityMode prefers per-session override', () => {
  const state = { settings: { verbosityMode: 'compact', composer: { pageVerbosity: { home: 'compact' } } } };
  const person = { uiVerbosity: 'full' };
  assert.equal(resolveVerbosityMode({ state, person, pageKey: 'home' }), 'full');
});

test('resolveVerbosityMode respects explicit mode', () => {
  const state = { settings: { verbosityMode: 'compact' } };
  const person = { uiVerbosity: 'full' };
  assert.equal(resolveVerbosityMode({ state, person, explicit: 'compact', pageKey: 'home' }), 'compact');
});

test('resolveVerbosityMode uses per-page preset when available', () => {
  const state = { settings: { verbosityMode: 'full', composer: { pageVerbosity: { discussion: 'compact' } } } };
  assert.equal(resolveVerbosityMode({ state, person: null, pageKey: 'discussion' }), 'compact');
});

test('resolveVerbosityMode falls back to Circle default', () => {
  const state = { settings: { verbosityMode: 'compact' } };
  assert.equal(resolveVerbosityMode({ state, person: null, pageKey: 'home' }), 'compact');
});

test('resolveVerbosityMode defaults to full when unset', () => {
  const state = { settings: {} };
  assert.equal(resolveVerbosityMode({ state, person: null, pageKey: 'home' }), 'full');
});
