import { test } from 'node:test';
import assert from 'node:assert/strict';

import { consumeRateLimit, DEFAULT_RATE_LIMITS } from '../src/modules/identity/rateLimit.js';

test('rate limiter blocks after max usage within window', () => {
  const state = {};
  const key = 'discussion_post';
  const actorKey = 'pid:rate-test';
  const limit = DEFAULT_RATE_LIMITS[key].max;
  const base = Date.now();

  for (let idx = 0; idx < limit; idx += 1) {
    const result = consumeRateLimit(state, { key, actorKey, now: base + idx });
    assert.equal(result.allowed, true);
  }

  const blocked = consumeRateLimit(state, { key, actorKey, now: base + limit });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter >= 1);
});

test('rate limiter tracks actors separately', () => {
  const state = {};
  const key = 'discussion_post';
  const base = Date.now();

  const alice = consumeRateLimit(state, { key, actorKey: 'pid:alice', now: base });
  const bob = consumeRateLimit(state, { key, actorKey: 'pid:bob', now: base });

  assert.equal(alice.allowed, true);
  assert.equal(bob.allowed, true);
});
