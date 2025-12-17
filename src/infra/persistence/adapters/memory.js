export function createMemoryAdapter() {
  return new MemoryStateStore();
}

class MemoryStateStore {
  constructor() {
    this.adapterId = 'memory';
    this._data = getEmptyData();
    this._meta = { schemaVersion: 0, migrations: [] };
  }

  async prepare() {
    // no-op for in-memory adapter
  }

  async loadData() {
    return clone(this._data);
  }

  async loadMeta() {
    return clone(this._meta);
  }

  async saveData(data) {
    this._data = clone({
      ...this._data,
      ...data,
    });
  }

  async saveMeta(meta) {
    this._meta = clone(meta);
  }

  async saveLedger(entries) {
    this._data.ledger = clone(entries || []);
  }

  async saveSessions(entries) {
    this._data.sessions = clone(entries || []);
  }

  async savePeers(entries) {
    this._data.peers = clone(entries || []);
  }

  async saveDiscussions(entries) {
    this._data.discussions = clone(entries || []);
  }

  async savePetitions(entries) {
    this._data.petitions = clone(entries || []);
  }

  async saveVotes(entries) {
    this._data.votes = clone(entries || []);
  }

  async saveSignatures(entries) {
    this._data.signatures = clone(entries || []);
  }

  async saveDelegations(entries) {
    this._data.delegations = clone(entries || []);
  }

  async saveNotifications(entries) {
    this._data.notifications = clone(entries || []);
  }

  async saveGroups(entries) {
    this._data.groups = clone(entries || []);
  }

  async saveGroupPolicies(entries) {
    this._data.groupPolicies = clone(entries || []);
  }

  async saveGroupElections(entries) {
    this._data.groupElections = clone(entries || []);
  }

  async saveActors(entries) {
    this._data.actors = clone(entries || []);
  }

  async saveSocialFollows(entries) {
    this._data.socialFollows = clone(entries || []);
  }

  async saveSocialPosts(entries) {
    this._data.socialPosts = clone(entries || []);
  }

  async saveSettings(settings) {
    this._data.settings = clone(settings || { initialized: false });
  }

  async saveProfileStructures(entries) {
    this._data.profileStructures = clone(entries || []);
  }

  async saveProfileAttributes(entries) {
    this._data.profileAttributes = clone(entries || []);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getEmptyData() {
  return {
    ledger: [],
    sessions: [],
    peers: [],
    discussions: [],
    petitions: [],
    signatures: [],
    votes: [],
    delegations: [],
    notifications: [],
    groups: [],
    groupPolicies: [],
    groupElections: [],
    actors: [],
    socialFollows: [],
    socialPosts: [],
    profileStructures: [],
    profileAttributes: [],
    settings: { initialized: false },
  };
}
