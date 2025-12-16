import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideStatus, filterVisibleEntries, getReplicationProfile, stampLocalEntry } from '../src/modules/federation/replication.js';

test('decideStatus blocks previews when previews disabled', () => {
  const profile = { mode: 'centralized', validationLevel: 'strict', allowPreviews: false };
  const status = decideStatus(profile, 'preview');
  assert.equal(status.status, 'rejected');
  assert.equal(status.allowPreview, false);
});

test('decideStatus marks previews when observe mode with previews allowed', () => {
  const profile = { mode: 'p2p', validationLevel: 'observe', allowPreviews: true };
  const status = decideStatus(profile, 'preview');
  assert.equal(status.status, 'preview');
  assert.equal(status.allowPreview, true);
});

test('filterVisibleEntries hides preview entries when previews disabled', () => {
  const state = { dataConfig: { allowPreviews: false } };
  const entries = [
    { id: 1, validationStatus: 'validated' },
    { id: 2, validationStatus: 'preview' },
  ];
  const visible = filterVisibleEntries(entries, state);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 1);
});

test('stampLocalEntry marks validated content by default', () => {
  const state = { dataConfig: { mode: 'hybrid', adapter: 'memory' } };
  const entry = stampLocalEntry(state, { id: 'x' });
  assert.equal(entry.validationStatus, 'validated');
  assert.equal(entry.mode, 'hybrid');
  assert.equal(entry.adapter, 'memory');
});

test('replication profile gates vote ingestion for preview payloads', () => {
  const makeState = (allowPreviews) => ({
    dataConfig: { mode: 'p2p', adapter: 'memory', validationLevel: 'strict', allowPreviews },
    votes: [],
  });
  const ingest = (state, envelopes) => {
    for (const envelope of envelopes) {
      const status = decideStatus(getReplicationProfile(state), envelope.status || 'validated');
      if (status.status === 'rejected') continue;
      state.votes.push({ ...envelope, validationStatus: status.status });
    }
    return state.votes;
  };

  const stateBlocked = makeState(false);
  ingest(stateBlocked, [{ petitionId: 'p1', authorHash: 'a', choice: 'yes', createdAt: 'now', status: 'preview' }]);
  assert.equal(stateBlocked.votes.length, 0, 'preview votes are blocked when previews are disabled');

  const stateAllowed = makeState(true);
  ingest(stateAllowed, [{ petitionId: 'p2', authorHash: 'b', choice: 'yes', createdAt: 'now', status: 'preview' }]);
  assert.equal(stateAllowed.votes.length, 1, 'preview votes are ingested when previews are allowed');
  assert.equal(stateAllowed.votes[0].validationStatus, 'preview');
});
