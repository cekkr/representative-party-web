import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createStateStore } from '../src/infra/persistence/store.js';

loadTestEnv();
const MYSQL_ENV = await buildMysqlEnv();
const MONGO_ENV = await buildMongoEnv();
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

test('mysql adapter round-trip', { skip: MYSQL_ENV.skip || false }, async () => {
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

test('mongodb adapter round-trip', { skip: MONGO_ENV.skip || false }, async () => {
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

async function buildMysqlEnv() {
  const url = process.env.TEST_MYSQL_URL || '';
  const host = process.env.TEST_MYSQL_HOST || '';
  const user = process.env.TEST_MYSQL_USER || '';
  const database = process.env.TEST_MYSQL_DATABASE || '';
  const enabled = Boolean(url || (host && user && database));
  const table = process.env.TEST_MYSQL_TABLE || `state_entries_test_${process.pid}`;
  const port = process.env.TEST_MYSQL_PORT || '';
  const password = process.env.TEST_MYSQL_PASSWORD || '';
  if (!enabled) {
    return {
      enabled: false,
      skip: 'mysql adapter env not configured',
      options: {
        adapter: 'mysql',
        mysqlUrl: url,
        mysqlHost: host,
        mysqlPort: port,
        mysqlUser: user,
        mysqlPassword: password,
        mysqlDatabase: database,
        mysqlTable: table,
      },
    };
  }
  const availability = await checkMysqlAvailability({ url, host, port, user, password, database });
  if (!availability.ok) {
    return {
      enabled: false,
      skip: availability.reason,
      options: {
        adapter: 'mysql',
        mysqlUrl: url,
        mysqlHost: host,
        mysqlPort: port,
        mysqlUser: user,
        mysqlPassword: password,
        mysqlDatabase: database,
        mysqlTable: table,
      },
    };
  }
  return {
    enabled,
    skip: false,
    options: {
      adapter: 'mysql',
      mysqlUrl: url,
      mysqlHost: host,
      mysqlPort: port,
      mysqlUser: user,
      mysqlPassword: password,
      mysqlDatabase: database,
      mysqlTable: table,
    },
  };
}

async function buildMongoEnv() {
  const url = process.env.TEST_MONGO_URL || process.env.TEST_MONGODB_URL || '';
  const db = process.env.TEST_MONGO_DB || process.env.TEST_MONGODB_DB || '';
  const enabled = Boolean(url);
  const collection = process.env.TEST_MONGO_COLLECTION || `state_entries_test_${process.pid}`;
  if (!enabled) {
    return {
      enabled: false,
      skip: 'mongodb adapter env not configured',
      options: {
        adapter: 'mongodb',
        mongoUrl: url,
        mongoDb: db,
        mongoCollection: collection,
      },
    };
  }
  const availability = await checkMongoAvailability({ url, db });
  if (!availability.ok) {
    return {
      enabled: false,
      skip: availability.reason,
      options: {
        adapter: 'mongodb',
        mongoUrl: url,
        mongoDb: db,
        mongoCollection: collection,
      },
    };
  }
  return {
    enabled,
    skip: false,
    options: {
      adapter: 'mongodb',
      mongoUrl: url,
      mongoDb: db,
      mongoCollection: collection,
    },
  };
}

async function closeStore(store) {
  if (store?.dropStore) {
    await store.dropStore();
  }
  if (store?.close) {
    await store.close();
    return;
  }
  if (store?.pool?.end) {
    await store.pool.end();
  }
  if (store?.client?.close) {
    await store.client.close();
  }
}

function loadTestEnv() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
    const parsed = parseDotEnv(raw);
    const keys = Object.keys(parsed || {});
    for (const key of keys) {
      if (!isTestEnvKey(key)) continue;
      if (process.env[key] === undefined) {
        process.env[key] = parsed[key];
      }
    }
  } catch (_error) {
    // .env is optional for tests
  }
}

function parseDotEnv(text = '') {
  const result = {};
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isTestEnvKey(key = '') {
  return key.startsWith('TEST_MYSQL_') || key.startsWith('TEST_MONGO_') || key.startsWith('TEST_MONGODB_');
}

async function checkMysqlAvailability({ url, host, port, user, password, database }) {
  let mysql;
  try {
    const mod = await import('mysql2/promise');
    mysql = mod.default || mod;
  } catch (_error) {
    return { ok: false, reason: 'mysql2 dependency missing' };
  }
  const config = resolveMysqlConfig({ url, host, port, user, password, database });
  if (!config.user) {
    return { ok: false, reason: 'mysql user missing' };
  }
  if (!config.database) {
    return { ok: false, reason: 'mysql database missing' };
  }
  try {
    const connection = await mysql.createConnection(config);
    await connection.query('SELECT 1');
    await connection.end();
    return { ok: true };
  } catch (error) {
    if (error?.code === 'ER_BAD_DB_ERROR' && !url && config.database) {
      const created = await createMysqlDatabase(mysql, { ...config, database: undefined }, config.database);
      if (created) {
        return checkMysqlAvailability({ url, host, port, user, password, database });
      }
    }
    return { ok: false, reason: `mysql unavailable: ${error?.code || error?.message || 'unknown'}` };
  }
}

function resolveMysqlConfig({ url, host, port, user, password, database }) {
  if (url) {
    try {
      const parsed = new URL(url);
      const resolvedDatabase = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
      return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username || ''),
        password: decodeURIComponent(parsed.password || ''),
        database: resolvedDatabase,
        connectTimeout: 1000,
      };
    } catch (_error) {
      return { host: '', port: 3306, user: '', password: '', database: '', connectTimeout: 1000 };
    }
  }
  const config = {
    host: host || '127.0.0.1',
    port: port ? Number(port) : 3306,
    user: user || '',
    password: password || undefined,
    database: database || '',
    connectTimeout: 1000,
  };
  if (!config.password) delete config.password;
  return config;
}

async function createMysqlDatabase(mysql, config, name) {
  if (!name) return false;
  try {
    const admin = await mysql.createConnection({ ...config, database: undefined });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
    await admin.end();
    return true;
  } catch (_error) {
    return false;
  }
}

async function checkMongoAvailability({ url, db }) {
  let mongodb;
  try {
    mongodb = await import('mongodb');
  } catch (_error) {
    return { ok: false, reason: 'mongodb dependency missing' };
  }
  const dbName = resolveMongoDbName(url, db);
  if (!dbName) {
    return { ok: false, reason: 'mongodb database missing' };
  }
  const { MongoClient } = mongodb;
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000 });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    await client.close();
    return { ok: true };
  } catch (error) {
    try {
      await client.close();
    } catch (_closeError) {
      // ignore
    }
    return { ok: false, reason: `mongodb unavailable: ${error?.code || error?.message || 'unknown'}` };
  }
}

function resolveMongoDbName(url, provided) {
  if (provided) return provided;
  try {
    const parsed = new URL(url);
    const name = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    return name || '';
  } catch (_error) {
    return '';
  }
}
