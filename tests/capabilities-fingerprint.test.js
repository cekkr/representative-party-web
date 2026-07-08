import { test } from 'node:test';
import assert from 'node:assert/strict';

import { listPeerCapabilities, recordPeerCapabilities } from '../src/modules/federation/capabilities.js';

test('recordPeerCapabilities stores fingerprint and skips unchanged snapshots', () => {
  const state = { settings: {} };
  const snapshot = {
    modules: { social: true, petitions: true, votes: false, delegation: true },
    replication: { mode: 'hybrid', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
  };
  const now = Date.now();

  const first = recordPeerCapabilities(state, 'https://peer.example', snapshot, { now: new Date(now) });
  assert.equal(first.updated, true);

  const caps = listPeerCapabilities(state);
  const [key] = Object.keys(caps);
  assert.ok(key, 'expected a peer capability entry');
  assert.ok(caps[key].fingerprint, 'expected fingerprint on capability entry');

  const second = recordPeerCapabilities(state, 'https://peer.example', { ...snapshot }, { now: new Date(now + 1000) });
  assert.equal(second.updated, false);

  const third = recordPeerCapabilities(
    state,
    'https://peer.example',
    { ...snapshot, modules: { ...snapshot.modules, votes: true } },
    { now: new Date(now + 2000) },
  );
  assert.equal(third.updated, true);
});
