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
      petitions: await this.readJson(FILES.petitions, []),
      signatures: await this.readJson(FILES.signatures, []),
      votes: await this.readJson(FILES.votes, []),
      delegations: await this.readJson(FILES.delegations, []),
      notifications: await this.readJson(FILES.notifications, []),
      groups: await this.readJson(FILES.groups, []),
      groupPolicies: await this.readJson(FILES.groupPolicies, []),
      groupElections: await this.readJson(FILES.groupElections, []),
      actors: await this.readJson(FILES.actors, []),
      settings: await this.readJson(FILES.settings, { initialized: false }),
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
    await this.writeJson(FILES.petitions, data.petitions || []);
    await this.writeJson(FILES.signatures, data.signatures || []);
    await this.writeJson(FILES.votes, data.votes || []);
    await this.writeJson(FILES.delegations, data.delegations || []);
    await this.writeJson(FILES.notifications, data.notifications || []);
    await this.writeJson(FILES.groups, data.groups || []);
    await this.writeJson(FILES.groupPolicies, data.groupPolicies || []);
    await this.writeJson(FILES.groupElections, data.groupElections || []);
    await this.writeJson(FILES.actors, data.actors || []);
    await this.writeJson(FILES.settings, data.settings || { initialized: false });
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

  async savePetitions(entries) {
    await this.writeJson(FILES.petitions, entries);
  }

  async saveVotes(entries) {
    await this.writeJson(FILES.votes, entries);
  }

  async saveSignatures(entries) {
    await this.writeJson(FILES.signatures, entries);
  }

  async saveDelegations(entries) {
    await this.writeJson(FILES.delegations, entries);
  }

  async saveNotifications(entries) {
    await this.writeJson(FILES.notifications, entries);
  }

  async saveGroups(entries) {
    await this.writeJson(FILES.groups, entries);
  }

  async saveGroupPolicies(entries) {
    await this.writeJson(FILES.groupPolicies, entries);
  }

  async saveGroupElections(entries) {
    await this.writeJson(FILES.groupElections, entries);
  }

  async saveActors(entries) {
    await this.writeJson(FILES.actors, entries);
  }

  async saveSettings(settings) {
    await this.writeJson(FILES.settings, settings);
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
