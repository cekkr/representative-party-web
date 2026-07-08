import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { buildVoteEnvelope, verifyVoteEnvelope } from '../src/modules/votes/voteEnvelope.js';
import {
  exportTransactionsEnvelope,
  logTransaction,
  verifyTransactionsEnvelope,
} from '../src/modules/transactions/registry.js';
import { ingestLedgerGossip } from '../src/modules/federation/ingest.js';
import { normalizeProviderBlindSettings } from '../src/modules/circle/ringRegistry.js';

function withSigningKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

function buildTransactionState(providerBlind) {
  return {
    issuer: 'local',
    settings: { providerBlind },
    transactions: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveTransactions: async () => {} },
  };
}

test('provider-blind observe emits ring + issuer signatures for vote envelopes', () => {
  const { publicPem, privatePem } = withSigningKeys();
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privatePem;
  process.env.CIRCLE_PUBLIC_KEY = publicPem;

  try {
    const providerBlind = {
      mode: 'observe',
      ring: {
        currentId: 'ring-1',
        keys: [publicPem.replace(/\n/g, '\\n')],
      },
    };
    const vote = {
      petitionId: 'petition-1',
      authorHash: 'person-1',
      choice: 'yes',
      createdAt: '2024-01-01T00:00:00.000Z',
      validationStatus: 'validated',
    };

    const envelope = buildVoteEnvelope(vote, { issuer: 'local', providerBlind });
    const result = verifyVoteEnvelope(envelope, { providerBlind });

    assert.ok(envelope.signature, 'expected legacy signature in observe mode');
    assert.ok(envelope.ringSignature, 'expected ringSignature in observe mode');
    assert.equal(envelope.ringId, 'ring-1');
    assert.equal(envelope.issuer, 'local');
    assert.equal(result.valid, true);
    assert.equal(result.skipped, false);
  } finally {
    process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
    process.env.CIRCLE_PUBLIC_KEY = prevPublic;
  }
});

test('provider-blind strict requires ring signatures for vote envelopes', () => {
  const { publicPem, privatePem } = withSigningKeys();
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privatePem;
  process.env.CIRCLE_PUBLIC_KEY = publicPem;

  try {
    const providerBlind = {
      mode: 'strict',
      ring: {
        currentId: 'ring-2',
        keys: [publicPem.replace(/\n/g, '\\n')],
      },
    };
    const vote = {
      petitionId: 'petition-2',
      authorHash: 'person-2',
      choice: 'no',
      createdAt: '2024-01-02T00:00:00.000Z',
      validationStatus: 'validated',
    };

    const envelope = buildVoteEnvelope(vote, { issuer: 'local', providerBlind });
    const result = verifyVoteEnvelope(envelope, { providerBlind });

    assert.ok(envelope.ringSignature, 'expected ringSignature in strict mode');
    assert.equal(envelope.issuer, undefined);
    assert.equal(result.valid, true);
    assert.equal(result.skipped, false);

    const legacy = buildVoteEnvelope(vote, { issuer: 'local' });
    const legacyResult = verifyVoteEnvelope(legacy, { providerBlind });
    assert.equal(legacyResult.valid, false, 'strict mode rejects envelopes without ringSignature');
  } finally {
    process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
    process.env.CIRCLE_PUBLIC_KEY = prevPublic;
  }
});

test('provider-blind observe emits ring + issuer signatures for transaction envelopes', async () => {
  const { publicPem, privatePem } = withSigningKeys();
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privatePem;
  process.env.CIRCLE_PUBLIC_KEY = publicPem;

  try {
    const providerBlind = {
      mode: 'observe',
      ring: {
        currentId: 'ring-3',
        keys: [publicPem.replace(/\n/g, '\\n')],
      },
    };
    const state = buildTransactionState(providerBlind);
    await logTransaction(state, {
      type: 'vote_cast',
      actorHash: 'person-3',
      petitionId: 'petition-3',
      payload: { choice: 'yes' },
    });

    const envelope = exportTransactionsEnvelope(state, { limit: 10 });
    const result = verifyTransactionsEnvelope(envelope, { providerBlind });

    assert.ok(envelope.signature, 'expected legacy signature in observe mode');
    assert.ok(envelope.ringSignature, 'expected ringSignature in observe mode');
    assert.equal(envelope.ringId, 'ring-3');
    assert.equal(envelope.issuer, 'local');
    assert.equal(result.valid, true);
    assert.equal(result.skipped, false);
  } finally {
    process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
    process.env.CIRCLE_PUBLIC_KEY = prevPublic;
  }
});

test('provider-blind ring id falls back to CIRCLE_RING_ID', () => {
  const prev = process.env.CIRCLE_RING_ID;
  process.env.CIRCLE_RING_ID = 'ring-env-01';
  try {
    const normalized = normalizeProviderBlindSettings({ mode: 'observe', ring: {} });
    assert.equal(normalized.ring.currentId, 'ring-env-01');
  } finally {
    if (prev === undefined) {
      delete process.env.CIRCLE_RING_ID;
    } else {
      process.env.CIRCLE_RING_ID = prev;
    }
  }
});

test('provider-blind strict requires ring signatures for transaction envelopes', async () => {
  const { publicPem, privatePem } = withSigningKeys();
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privatePem;
  process.env.CIRCLE_PUBLIC_KEY = publicPem;

  try {
    const providerBlind = {
      mode: 'strict',
      ring: {
        currentId: 'ring-4',
        keys: [publicPem.replace(/\n/g, '\\n')],
      },
    };
    const state = buildTransactionState(providerBlind);
    await logTransaction(state, {
      type: 'vote_cast',
      actorHash: 'person-4',
      petitionId: 'petition-4',
      payload: { choice: 'no' },
    });

    const envelope = exportTransactionsEnvelope(state, { limit: 10 });
    const result = verifyTransactionsEnvelope(envelope, { providerBlind });

    assert.ok(envelope.ringSignature, 'expected ringSignature in strict mode');
    assert.equal(envelope.issuer, undefined);
    assert.equal(result.valid, true);
    assert.equal(result.skipped, false);

    state.settings.providerBlind = { mode: 'off' };
    const legacy = exportTransactionsEnvelope(state, { limit: 10 });
    const legacyResult = verifyTransactionsEnvelope(legacy, { providerBlind });
    assert.equal(legacyResult.valid, false, 'strict mode rejects envelopes without ringSignature');
  } finally {
    process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
    process.env.CIRCLE_PUBLIC_KEY = prevPublic;
  }
});

test('gossip registry merges provider-blind ring announcements into settings', async () => {
  let savedSettings = null;
  const state = {
    issuer: 'local',
    settings: { initialized: true, providerBlind: { mode: 'off' }, peerHealth: {} },
    uniquenessLedger: new Set(),
    peers: new Set(),
    dataConfig: { mode: 'p2p', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: {
      saveSettings: async (next) => {
        savedSettings = next;
      },
      savePeers: async () => {},
      saveLedger: async () => {},
    },
  };

  const providerBlind = {
    mode: 'observe',
    ring: {
      id: 'ring-2025-09',
      keys: ['key-a', 'key-b', 'key-c', 'key-d', 'key-e'],
      epochSeconds: 86_400,
      maxSize: 32,
    },
    audit: {
      threshold: 3,
      members: [
        { keyId: 'member-1', role: 'member' },
        { keyId: 'member-2', role: 'member' },
        { keyId: 'provider-1', role: 'provider' },
        { keyId: 'provider-2', role: 'provider' },
        { keyId: 'observer-1', role: 'observer' },
      ],
    },
  };

  await ingestLedgerGossip({ state, hashes: [], providerBlind });

  assert.equal(state.settings.providerBlind.ring.currentId, 'ring-2025-09');
  assert.equal(state.settings.providerBlind.ring.keys.length, 5);
  assert.equal(state.settings.providerBlind.audit.members.length, 5);
  assert.equal(state.settings.providerBlind.audit.threshold, 3);
  assert.ok(savedSettings, 'expected provider-blind settings to persist');
});
