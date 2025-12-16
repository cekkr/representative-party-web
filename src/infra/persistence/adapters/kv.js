export function createKeyValueAdapter() {
  return new KeyValueStateStore();
}

class KeyValueStateStore {
  constructor() {
    this.adapterId = 'kv';
  }

  async prepare() {
    throw notImplemented();
  }

  async loadData() {
    throw notImplemented();
  }

  async loadMeta() {
    throw notImplemented();
  }

  async saveData() {
    throw notImplemented();
  }

  async saveMeta() {
    throw notImplemented();
  }

  async saveLedger() {
    throw notImplemented();
  }

  async saveSessions() {
    throw notImplemented();
  }

  async savePeers() {
    throw notImplemented();
  }

  async saveDiscussions() {
    throw notImplemented();
  }

  async savePetitions() {
    throw notImplemented();
  }

  async saveVotes() {
    throw notImplemented();
  }

  async saveSignatures() {
    throw notImplemented();
  }

  async saveDelegations() {
    throw notImplemented();
  }

  async saveNotifications() {
    throw notImplemented();
  }

  async saveGroups() {
    throw notImplemented();
  }

  async saveGroupPolicies() {
    throw notImplemented();
  }

  async saveGroupElections() {
    throw notImplemented();
  }

  async saveActors() {
    throw notImplemented();
  }

  async saveSettings() {
    throw notImplemented();
  }
}

function notImplemented() {
  return new Error('Key-value adapter is not implemented yet. Configure DATA_ADAPTER=json|memory until the KV driver is added.');
}
