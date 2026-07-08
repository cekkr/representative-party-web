import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildLedgerEnvelope } from '../src/modules/circle/federation.js';
import { ingestLedgerGossip } from '../src/modules/federation/ingest.js';

test('ledger gossip rejects policy mismatch and records peer failure', async () => {
  const state = {
    uniquenessLedger: new Set(['alpha']),
    peers: new Set(),
    settings: { peerHealth: {} },
    store: {
      saveSettings: async () => {},
      saveLedger: async () => {},
      savePeers: async () => {},
    },
    dataConfig: {
      mode: 'hybrid',
      adapter: 'memory',
      validationLevel: 'strict',
      allowPreviews: true,
    },
    issuer: 'local-circle',
  };

  const envelope = buildLedgerEnvelope(state);
  envelope.policy = { ...envelope.policy, id: 'other-circle' };

  const result = await ingestLedgerGossip({
    state,
    envelope,
    peerHint: 'https://peer.example',
  });

  assert.equal(result.statusCode, 409);
  assert.equal(result.payload.error, 'policy_mismatch');

  const peerEntry = state.settings.peerHealth['https://peer.example'];
  assert.ok(peerEntry, 'expected peer health entry');
  assert.equal(peerEntry.lastFailureReason, 'policy_mismatch');
});
