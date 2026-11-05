import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { PATHS } from '../../../config.js';

const KEYS = [
  'ledger',
  'sessions',
  'peers',
  'discussions',
  'organizationCases',
  'petitions',
  'signatures',
  'votes',
  'delegations',
  'notifications',
  'topics',
  'groups',
  'groupPolicies',
  'groupElections',
  'actors',
  'socialFollows',
  'socialPosts',
  'socialMedia',
  'activityPubIndex',
  'transactions',
  'transactionSummaries',
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
    this.pendingWrite = Promise.resolve();
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
    const entries = {};
    for (const key of KEYS) {
      if (key === 'organizationCases' && !data.organizationCases?.length) continue;
      entries[key] = data[key] ?? defaultForKey(key);
    }
    await this.saveEntries(entries);
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

  async saveOrganizationCases(entries) {
    await this.saveKey('organizationCases', entries);
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

  async saveTopics(entries) {
    await this.saveKey('topics', entries);
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

  async saveSocialMedia(entries) {
    await this.saveKey('socialMedia', entries);
  }

  async saveActivityPubIndex(index) {
    await this.saveKey('activityPubIndex', index ?? null);
  }

  async saveTransactions(entries) {
    await this.saveKey('transactions', entries);
  }

  async saveTransactionSummaries(entries) {
    await this.saveKey('transactionSummaries', entries);
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
    await this.saveEntries({ [key]: value });
  }

  saveEntries(entries) {
    const write = this.pendingWrite.then(async () => {
      const store = this.cache || (await this.readStore());
      const next = { ...store, ...entries };
      await this.writeStore(next);
      this.cache = next;
    });
    this.pendingWrite = write.catch(() => {});
    return write;
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
    const pendingFile = this.filename + '.tmp';
    try {
      await writeFile(pendingFile, JSON.stringify(store, null, 2));
      await rename(pendingFile, this.filename);
    } finally {
      await rm(pendingFile, { force: true });
    }
  }
}

function defaultForKey(key) {
  if (key === 'meta') return { schemaVersion: 0, migrations: [] };
  if (key === 'settings') return { initialized: false };
  if (key === 'activityPubIndex') return null;
  return [];
}
