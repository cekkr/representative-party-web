import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blindHash } from '../src/modules/identity/auth.js';

test('blindHash is deterministic for the same input', () => {
  const hashA = blindHash('pid-123', 'salt-abc');
  const hashB = blindHash('pid-123', 'salt-abc');
  assert.equal(hashA, hashB);
  assert.equal(hashA.length, 64);
});

test('blindHash changes when the salt changes', () => {
  const hashA = blindHash('pid-123', 'salt-abc');
  const hashB = blindHash('pid-123', 'salt-other');
  assert.notEqual(hashA, hashB);
});
