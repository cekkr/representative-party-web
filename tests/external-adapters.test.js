import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStateStore } from '../src/infra/persistence/store.js';

const MYSQL_ENV = buildMysqlEnv();
const MONGO_ENV = buildMongoEnv();
const SEED = {
  ledger: ['hash-1'],
  sessions: [
    {
      id: 'sess-1',
      handle: 'user-1',
      role: 'user',
      banned: false,
      pidHash: 'hash-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    },
  ],
  settings: { initialized: true, circleName: 'Adapter Test' },
};

test('mysql adapter round-trip', { skip: !MYSQL_ENV.enabled }, async () => {
  const store = createStateStore(MYSQL_ENV.options);
  try {
    await store.prepare();
    await store.saveData(SEED);
    const data = await store.loadData();

    assert.deepEqual(data.ledger, SEED.ledger);
    assert.equal(data.sessions[0]?.id, 'sess-1');
    assert.equal(data.settings?.initialized, true);
  } finally {
    await closeStore(store);
  }
});

test('mongodb adapter round-trip', { skip: !MONGO_ENV.enabled }, async () => {
  const store = createStateStore(MONGO_ENV.options);
  try {
    await store.prepare();
    await store.saveData(SEED);
    const data = await store.loadData();

    assert.deepEqual(data.ledger, SEED.ledger);
    assert.equal(data.sessions[0]?.id, 'sess-1');
    assert.equal(data.settings?.initialized, true);
  } finally {
    await closeStore(store);
  }
});

function buildMysqlEnv() {
  const url = process.env.TEST_MYSQL_URL || '';
  const host = process.env.TEST_MYSQL_HOST || '';
  const user = process.env.TEST_MYSQL_USER || '';
  const database = process.env.TEST_MYSQL_DATABASE || '';
  const enabled = Boolean(url || (host && user && database));
  const table = process.env.TEST_MYSQL_TABLE || `state_entries_test_${process.pid}`;
  return {
    enabled,
    options: {
      adapter: 'mysql',
      mysqlUrl: url,
      mysqlHost: host,
      mysqlPort: process.env.TEST_MYSQL_PORT || '',
      mysqlUser: user,
      mysqlPassword: process.env.TEST_MYSQL_PASSWORD || '',
      mysqlDatabase: database,
      mysqlTable: table,
    },
  };
}

function buildMongoEnv() {
  const url = process.env.TEST_MONGO_URL || process.env.TEST_MONGODB_URL || '';
  const db = process.env.TEST_MONGO_DB || process.env.TEST_MONGODB_DB || '';
  const enabled = Boolean(url);
  const collection = process.env.TEST_MONGO_COLLECTION || `state_entries_test_${process.pid}`;
  return {
    enabled,
    options: {
      adapter: 'mongodb',
      mongoUrl: url,
      mongoDb: db,
      mongoCollection: collection,
    },
  };
}

async function closeStore(store) {
  if (store?.pool?.end) {
    await store.pool.end();
  }
  if (store?.client?.close) {
    await store.client.close();
  }
}
