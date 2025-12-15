import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { FILES, PATHS } from '../config.js';

export function createStateStore() {
  return new JsonStateStore();
}

class JsonStateStore {
  async prepare() {
    await mkdir(PATHS.DATA_ROOT, { recursive: true });
  }

  async loadData() {
    return {
      ledger: await this.readJson(FILES.ledger, []),
      sessions: await this.readJson(FILES.sessions, []),
      peers: await this.readJson(FILES.peers, []),
      discussions: await this.readJson(FILES.discussions, []),
      actors: await this.readJson(FILES.actors, []),
    };
  }

  async loadMeta() {
    return this.readJson(FILES.meta, { schemaVersion: 0, migrations: [] });
  }

  async saveData(data) {
    await this.writeJson(FILES.ledger, data.ledger || []);
    await this.writeJson(FILES.sessions, data.sessions || []);
    await this.writeJson(FILES.peers, data.peers || []);
    await this.writeJson(FILES.discussions, data.discussions || []);
    await this.writeJson(FILES.actors, data.actors || []);
  }

  async saveMeta(meta) {
    await this.writeJson(FILES.meta, meta);
  }

  async saveLedger(entries) {
    await this.writeJson(FILES.ledger, entries);
  }

  async saveSessions(entries) {
    await this.writeJson(FILES.sessions, entries);
  }

  async savePeers(entries) {
    await this.writeJson(FILES.peers, entries);
  }

  async saveDiscussions(entries) {
    await this.writeJson(FILES.discussions, entries);
  }

  async saveActors(entries) {
    await this.writeJson(FILES.actors, entries);
  }

  async readJson(filePath, fallback) {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async writeJson(filePath, value) {
    await writeFile(filePath, JSON.stringify(value, null, 2));
  }
}
