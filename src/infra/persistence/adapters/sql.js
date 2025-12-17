import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { FILES, PATHS } from '../../../config.js';

const KEYS = [
  'ledger',
  'sessions',
  'peers',
  'discussions',
  'petitions',
  'signatures',
  'votes',
  'delegations',
  'notifications',
  'groups',
  'groupPolicies',
  'groupElections',
  'actors',
  'socialFollows',
  'socialPosts',
  'profileStructures',
  'profileAttributes',
  'settings',
  'meta',
];

export function createSqlAdapter(options = {}) {
  const filename = resolveFilename(options);
  return new SqlStateStore(filename);
}

class SqlStateStore {
  constructor(filename) {
    this.adapterId = 'sql';
    this.filename = filename;
    this.db = null;
  }

  async prepare() {
    await mkdir(dirname(this.filename), { recursive: true });
    const sqlite = await loadSqlite();
    this.db = new sqlite.Database(this.filename);
    await run(this.db, 'CREATE TABLE IF NOT EXISTS state_entries (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  async loadData() {
    const data = {};
    for (const key of KEYS) {
      data[key] = await this.readJson(key, defaultForKey(key));
    }
    return data;
  }

  async loadMeta() {
    return this.readJson('meta', { schemaVersion: 0, migrations: [] });
  }

  async saveData(data) {
    for (const key of KEYS) {
      await this.writeJson(key, data[key] || defaultForKey(key));
    }
  }

  async saveMeta(meta) {
    await this.writeJson('meta', meta);
  }

  async saveLedger(entries) {
    await this.writeJson('ledger', entries);
  }

  async saveSessions(entries) {
    await this.writeJson('sessions', entries);
  }

  async savePeers(entries) {
    await this.writeJson('peers', entries);
  }

  async saveDiscussions(entries) {
    await this.writeJson('discussions', entries);
  }

  async savePetitions(entries) {
    await this.writeJson('petitions', entries);
  }

  async saveVotes(entries) {
    await this.writeJson('votes', entries);
  }

  async saveSignatures(entries) {
    await this.writeJson('signatures', entries);
  }

  async saveDelegations(entries) {
    await this.writeJson('delegations', entries);
  }

  async saveNotifications(entries) {
    await this.writeJson('notifications', entries);
  }

  async saveGroups(entries) {
    await this.writeJson('groups', entries);
  }

  async saveGroupPolicies(entries) {
    await this.writeJson('groupPolicies', entries);
  }

  async saveGroupElections(entries) {
    await this.writeJson('groupElections', entries);
  }

  async saveActors(entries) {
    await this.writeJson('actors', entries);
  }

  async saveSocialFollows(entries) {
    await this.writeJson('socialFollows', entries);
  }

  async saveSocialPosts(entries) {
    await this.writeJson('socialPosts', entries);
  }

  async saveProfileStructures(entries) {
    await this.writeJson('profileStructures', entries);
  }

  async saveProfileAttributes(entries) {
    await this.writeJson('profileAttributes', entries);
  }

  async saveSettings(settings) {
    await this.writeJson('settings', settings);
  }

  async readJson(key, fallback) {
    const row = await get(this.db, 'SELECT value FROM state_entries WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch (error) {
      console.warn(`[sql adapter] Failed to parse key "${key}", using fallback`, error);
      return fallback;
    }
  }

  async writeJson(key, value) {
    const payload = JSON.stringify(value, null, 0);
    await run(this.db, 'INSERT INTO state_entries (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
      key,
      payload,
    ]);
  }
}

function defaultForKey(key) {
  if (key === 'meta') return { schemaVersion: 0, migrations: [] };
  if (key === 'settings') return { initialized: false };
  if (key === 'ledger' || key === 'sessions' || key === 'peers' || key === 'actors') return [];
  return [];
}

async function loadSqlite() {
  try {
    const sqlite = await import('sqlite3');
    return sqlite.default?.verbose ? sqlite.default.verbose() : sqlite.verbose ? sqlite.verbose() : sqlite;
  } catch (error) {
    throw new Error(
      'SQL adapter requires the optional "sqlite3" dependency. Install it and set DATA_ADAPTER=sql, or switch to DATA_ADAPTER=json|memory.',
      { cause: error },
    );
  }
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, function callback(err, row) {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function resolveFilename(options = {}) {
  const value = options.sqliteFile || options.filename || PATHS.DATA_SQLITE;
  if (!value) return PATHS.DATA_SQLITE;
  if (value.startsWith('sqlite://') || value.startsWith('file://')) {
    try {
      const parsed = new URL(value);
      return parsed.pathname || PATHS.DATA_SQLITE;
    } catch (error) {
      return value;
    }
  }
  return value;
}
