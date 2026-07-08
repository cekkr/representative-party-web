import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findElements, assertSnapshot } from '../scripts/agent-viewport.js';

const stubSnapshot = {
  url: 'https://example.test',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
  elements: [
    {
      id: 'e1_aaaaaa',
      text: 'Welcome Home',
      name: '',
      kind: 'text',
      role: 'generic',
      tag: 'h1',
      actions: [],
      disabled: false,
      rect: { x: 10, y: 10, width: 200, height: 30 },
    },
    {
      id: 'e2_bbbbbb',
      text: '',
      name: 'Sign In',
      kind: 'button',
      role: 'button',
      tag: 'button',
      actions: ['click'],
      disabled: false,
      rect: { x: 10, y: 60, width: 90, height: 28 },
    },
    {
      id: 'e3_cccccc',
      text: 'More information',
      name: '',
      kind: 'link',
      role: 'link',
      tag: 'a',
      actions: ['click'],
      disabled: false,
      rect: { x: 10, y: 100, width: 160, height: 20 },
    },
    {
      id: 'e4_dddddd',
      text: '',
      name: 'Email',
      kind: 'input',
      role: 'textbox',
      tag: 'input',
      actions: ['click', 'type', 'clear'],
      disabled: false,
      rect: { x: 10, y: 130, width: 200, height: 26 },
    },
    {
      id: 'e5_eeeeee',
      text: 'Disabled Button',
      name: '',
      kind: 'button',
      role: 'button',
      tag: 'button',
      actions: ['click'],
      disabled: true,
      rect: { x: 10, y: 170, width: 140, height: 28 },
    },
  ],
};

test('findElements matches text, label, and role filters', () => {
  const textMatches = findElements(stubSnapshot, { text: 'welcome' });
  assert.equal(textMatches.length, 1);
  assert.equal(textMatches[0].id, 'e1_aaaaaa');

  const labelMatches = findElements(stubSnapshot, { label: 'sign in' });
  assert.equal(labelMatches.length, 1);
  assert.equal(labelMatches[0].id, 'e2_bbbbbb');

  const roleMatches = findElements(stubSnapshot, { role: 'button', action: 'click' });
  assert.deepEqual(roleMatches.map(el => el.id), ['e2_bbbbbb', 'e5_eeeeee']);

  const nthMatch = findElements(stubSnapshot, { role: 'button', nth: 2 });
  assert.equal(nthMatch.length, 1);
  assert.equal(nthMatch[0].id, 'e5_eeeeee');
});

test('findElements supports regex and within filters', () => {
  const regexMatches = findElements(stubSnapshot, { text: { regex: '^More' } });
  assert.equal(regexMatches.length, 1);
  assert.equal(regexMatches[0].id, 'e3_cccccc');

  const withinMatch = findElements(stubSnapshot, {
    within: { x: 0, y: 0, width: 50, height: 50, mode: 'intersects' },
  });
  assert.equal(withinMatch.length, 1);
  assert.equal(withinMatch[0].id, 'e1_aaaaaa');
});

test('assertSnapshot enforces counts and can return a report', () => {
  assert.doesNotThrow(() => {
    assertSnapshot(stubSnapshot, { target: { role: 'link' }, count: 1 });
  });

  assert.throws(() => {
    assertSnapshot(stubSnapshot, { target: { text: 'Missing' }, count: 1 });
  });

  const report = assertSnapshot(
    stubSnapshot,
    [
      { id: 'ok', target: { role: 'link' }, count: 1 },
      { id: 'missing', target: { text: 'Missing' }, count: 1 },
    ],
    { throwOnFailure: false }
  );

  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].id, 'missing');
  assert.equal(report.failures[0].count, 0);
});
