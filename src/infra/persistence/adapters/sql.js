export function createSqlAdapter() {
  return new SqlStateStore();
}

class SqlStateStore {
  constructor() {
    this.adapterId = 'sql';
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
  return new Error('SQL adapter is not implemented yet. Configure DATA_ADAPTER=json|memory until the SQL driver is added.');
}
