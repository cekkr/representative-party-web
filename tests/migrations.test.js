import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LATEST_SCHEMA_VERSION, runMigrations } from '../src/infra/persistence/migrations.js';

test('migrations normalize sessions and settings', () => {
  const rawData = {
    ledger: ['hash-a', 'hash-a'],
    sessions: [{ sessionId: 'sess-123', pidHash: 'hash-a' }],
    peers: ['https://peer.example'],
    discussions: [],
    petitions: [
      {
        id: 'petition-1',
        title: 'Test petition',
        summary: 'Test summary',
        body: 'Test body',
        authorHash: 'hash-a',
        createdAt: '2024-01-01T00:00:00.000Z',
        status: 'draft',
        quorum: 0,
        topic: 'general',
      },
    ],
    signatures: [],
    votes: [],
    delegations: [],
    notifications: [],
    groups: [],
    groupElections: [],
    actors: [],
    settings: {},
    socialFollows: [],
    socialPosts: [],
    topics: [],
  };

  const meta = { schemaVersion: 0, migrations: [] };
  const { data, meta: migratedMeta } = runMigrations({ data: rawData, meta });
  const [session] = data.sessions;

  assert.equal(migratedMeta.schemaVersion, LATEST_SCHEMA_VERSION);
  assert.equal(data.ledger.length, 1, 'deduplicated ledger entries');
  assert.equal(session.id, 'sess-123');
  assert.equal(session.role, 'person');
  assert.equal(session.banned, false);
  assert.ok(session.handle.startsWith('person-'));
  assert.equal(data.settings.circleName, 'Party Circle');
  assert.ok(data.settings.modules);
  assert.equal(data.settings.modules.petitions, true);
  assert.ok(Array.isArray(data.petitions));
  assert.ok(data.petitions[0].versions?.length);
  assert.equal(data.petitions[0].updatedAt, data.petitions[0].createdAt);
  assert.equal(data.petitions[0].updatedBy, data.petitions[0].authorHash);
  assert.ok(Array.isArray(data.signatures));
  assert.ok(Array.isArray(data.votes));
  assert.ok(Array.isArray(data.delegations));
  assert.ok(Array.isArray(data.notifications));
  assert.ok(Array.isArray(data.topics));
  assert.ok(Array.isArray(data.groups));
  assert.ok(Array.isArray(data.groupElections));
  assert.ok(Array.isArray(data.socialFollows));
  assert.ok(Array.isArray(data.socialPosts));
  assert.ok(Array.isArray(data.transactions));
  assert.ok(Array.isArray(data.transactionSummaries));
  assert.ok(Array.isArray(data.profileStructures));
  assert.ok(Array.isArray(data.profileAttributes));
  assert.deepEqual(data.settings.extensions, []);
});
