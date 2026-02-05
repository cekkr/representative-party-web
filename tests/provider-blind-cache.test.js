import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildProviderBlindAnnouncement } from '../src/modules/circle/ringRegistry.js';

test('buildProviderBlindAnnouncement caches by updatedAt', () => {
  const providerBlind = {
    mode: 'observe',
    updatedAt: new Date().toISOString(),
    ring: {
      currentId: 'ring-alpha',
      epochSeconds: 86_400,
      maxSize: 5,
      keys: ['key-a', 'key-b', 'key-c'],
    },
    rings: [],
    audit: {
      threshold: 3,
      members: [],
      requireReason: true,
      maxScopeDays: 30,
      emergencyOverride: false,
      overrideComposition: false,
    },
    transport: {
      mixnetEnabled: false,
      relays: [],
      maxHops: 2,
      timeoutMs: 5000,
    },
  };

  const first = buildProviderBlindAnnouncement(providerBlind);
  const second = buildProviderBlindAnnouncement(providerBlind);
  assert.strictEqual(first, second, 'expected cached announcement to reuse same object');

  providerBlind.updatedAt = new Date(Date.now() + 1000).toISOString();
  const third = buildProviderBlindAnnouncement(providerBlind);
  assert.notStrictEqual(third, first, 'expected cache to refresh after updatedAt changes');
});
