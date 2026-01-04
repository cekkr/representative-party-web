import { createJsonAdapter } from './json.js';
import { createMemoryAdapter } from './memory.js';
import { createSqlAdapter } from './sql.js';
import { createKeyValueAdapter } from './kv.js';
import { createMysqlAdapter } from './mysql.js';
import { createMongoAdapter } from './mongodb.js';

const REGISTRY = {
  json: createJsonAdapter,
  memory: createMemoryAdapter,
  sql: createSqlAdapter,
  kv: createKeyValueAdapter,
  mysql: createMysqlAdapter,
  mongodb: createMongoAdapter,
};

export function resolveAdapter(name = 'json') {
  const normalized = normalizeAdapter(name);
  return REGISTRY[normalized] || REGISTRY.json;
}

export function listAdapters() {
  return [...new Set(Object.keys(REGISTRY))];
}

export function normalizeAdapter(name) {
  if (!name) return 'json';
  const normalized = String(name).trim().toLowerCase();
  const aliases = {
    sqlite: 'sql',
    postgres: 'sql',
    postgresql: 'sql',
    mariadb: 'mysql',
    mongo: 'mongodb',
    keyvalue: 'kv',
    key_value: 'kv',
  };
  return aliases[normalized] || normalized;
}
