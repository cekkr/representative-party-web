import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POLICIES } from '../src/config.js';
import { ingestVoteGossip } from '../src/modules/federation/ingest.js';

function buildState({ allowPreviews = true } = {}) {
  return {
    votes: [],
    settings: { peerHealth: {} },
    dataConfig: { mode: 'p2p', adapter: 'memory', validationLevel: 'strict', allowPreviews },
    store: {
      saveVotes: async () => {},
      saveSettings: async () => {},
    },
  };
}

test('vote gossip replaces older envelopes and blocks preview downgrades', async () => {
  const state = buildState({ allowPreviews: true });
  const base = {
    issuer: 'peer-1',
    policy: { id: POLICIES.id, version: POLICIES.version },
    petitionId: 'petition-1',
    authorHash: 'author-1',
  };
  const older = {
    ...base,
    choice: 'yes',
    createdAt: '2024-01-01T00:00:00.000Z',
    status: 'validated',
  };
  await ingestVoteGossip({ state, envelopes: [older], peerHint: 'peer-1' });
  assert.equal(state.votes.length, 1);
  assert.equal(state.votes[0].choice, 'yes');

  const newer = {
    ...base,
    choice: 'no',
    createdAt: '2024-01-02T00:00:00.000Z',
    status: 'validated',
  };
  const update = await ingestVoteGossip({ state, envelopes: [newer], peerHint: 'peer-1' });
  assert.equal(state.votes.length, 1);
  assert.equal(state.votes[0].choice, 'no');
  assert.equal(update.updated, 1);

  const preview = {
    ...base,
    choice: 'abstain',
    createdAt: '2024-01-03T00:00:00.000Z',
    status: 'preview',
  };
  const downgrade = await ingestVoteGossip({ state, envelopes: [preview], peerHint: 'peer-1' });
  assert.equal(state.votes[0].choice, 'no');
  assert.equal(downgrade.updated, 0);
});
