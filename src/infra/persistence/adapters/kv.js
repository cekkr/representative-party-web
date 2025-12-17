import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { PATHS } from '../../../config.js';

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

export function createKeyValueAdapter(options = {}) {
  const filename = options.kvFile || options.filename || PATHS.DATA_KV;
  return new KeyValueStateStore(filename);
}

class KeyValueStateStore {
  constructor(filename) {
    this.adapterId = 'kv';
    this.filename = filename;
    this.cache = null;
  }

  async prepare() {
    await mkdir(dirname(this.filename), { recursive: true });
    this.cache = await this.readStore();
  }

  async loadData() {
    const store = this.cache || (await this.readStore());
    const data = {};
    for (const key of KEYS) {
      data[key] = store[key] ?? defaultForKey(key);
    }
    return data;
  }

  async loadMeta() {
    const store = this.cache || (await this.readStore());
    return store.meta || { schemaVersion: 0, migrations: [] };
  }

  async saveData(data) {
    const store = this.cache || (await this.readStore());
    const next = { ...store };
    for (const key of KEYS) {
      next[key] = data[key] ?? defaultForKey(key);
    }
    this.cache = next;
    await this.writeStore(next);
  }

  async saveMeta(meta) {
    await this.saveKey('meta', meta);
  }

  async saveLedger(entries) {
    await this.saveKey('ledger', entries);
  }

  async saveSessions(entries) {
    await this.saveKey('sessions', entries);
  }

  async savePeers(entries) {
    await this.saveKey('peers', entries);
  }

  async saveDiscussions(entries) {
    await this.saveKey('discussions', entries);
  }

  async savePetitions(entries) {
    await this.saveKey('petitions', entries);
  }

  async saveVotes(entries) {
    await this.saveKey('votes', entries);
  }

  async saveSignatures(entries) {
    await this.saveKey('signatures', entries);
  }

  async saveDelegations(entries) {
    await this.saveKey('delegations', entries);
  }

  async saveNotifications(entries) {
    await this.saveKey('notifications', entries);
  }

  async saveGroups(entries) {
    await this.saveKey('groups', entries);
  }

  async saveGroupPolicies(entries) {
    await this.saveKey('groupPolicies', entries);
  }

  async saveGroupElections(entries) {
    await this.saveKey('groupElections', entries);
  }

  async saveActors(entries) {
    await this.saveKey('actors', entries);
  }

  async saveSocialFollows(entries) {
    await this.saveKey('socialFollows', entries);
  }

  async saveSocialPosts(entries) {
    await this.saveKey('socialPosts', entries);
  }

  async saveProfileStructures(entries) {
    await this.saveKey('profileStructures', entries);
  }

  async saveProfileAttributes(entries) {
    await this.saveKey('profileAttributes', entries);
  }

  async saveSettings(settings) {
    await this.saveKey('settings', settings);
  }

  async saveKey(key, value) {
    const store = this.cache || (await this.readStore());
    const next = { ...store, [key]: value };
    this.cache = next;
    await this.writeStore(next);
  }

  async readStore() {
    try {
      const raw = await readFile(this.filename, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async writeStore(store) {
    await writeFile(this.filename, JSON.stringify(store, null, 2));
  }
}

function defaultForKey(key) {
  if (key === 'meta') return { schemaVersion: 0, migrations: [] };
  if (key === 'settings') return { initialized: false };
  return [];
}
