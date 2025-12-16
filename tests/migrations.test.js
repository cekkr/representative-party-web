import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LATEST_SCHEMA_VERSION, runMigrations } from '../src/infra/persistence/migrations.js';

test('migrations normalize sessions and settings', () => {
  const rawData = {
    ledger: ['hash-a', 'hash-a'],
    sessions: [{ sessionId: 'sess-123', pidHash: 'hash-a' }],
    peers: ['https://peer.example'],
    discussions: [],
    petitions: [],
    signatures: [],
    votes: [],
    delegations: [],
    notifications: [],
    groups: [],
    groupElections: [],
    actors: [],
    settings: {},
  };

  const meta = { schemaVersion: 0, migrations: [] };
  const { data, meta: migratedMeta } = runMigrations({ data: rawData, meta });
  const [session] = data.sessions;

  assert.equal(migratedMeta.schemaVersion, LATEST_SCHEMA_VERSION);
  assert.equal(data.ledger.length, 1, 'deduplicated ledger entries');
  assert.equal(session.id, 'sess-123');
  assert.equal(session.role, 'citizen');
  assert.equal(session.banned, false);
  assert.ok(session.handle.startsWith('citizen-'));
  assert.equal(data.settings.circleName, 'Party Circle');
  assert.ok(Array.isArray(data.petitions));
  assert.ok(Array.isArray(data.signatures));
  assert.ok(Array.isArray(data.votes));
  assert.ok(Array.isArray(data.delegations));
  assert.ok(Array.isArray(data.notifications));
  assert.ok(Array.isArray(data.groups));
  assert.ok(Array.isArray(data.groupElections));
  assert.deepEqual(data.settings.extensions, []);
});
