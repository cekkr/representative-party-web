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
  'topics',
  'groups',
  'groupPolicies',
  'groupElections',
  'actors',
  'socialFollows',
  'socialPosts',
  'socialMedia',
  'transactions',
  'transactionSummaries',
  'profileStructures',
  'profileAttributes',
  'settings',
  'meta',
];

const DEFAULT_COLLECTION = 'state_entries';

export function createMongoAdapter(options = {}) {
  return new MongoStateStore(options);
}

class MongoStateStore {
  constructor(options = {}) {
    this.adapterId = 'mongodb';
    this.options = options;
    this.client = null;
    this.db = null;
    this.collection = null;
    this.collectionName = normalizeName(options.mongoCollection || options.collection || DEFAULT_COLLECTION, 'collection');
    this.connectionLabel = buildConnectionLabel(options, this.collectionName);
  }

  async prepare() {
    const { MongoClient } = await loadMongo();
    const url = resolveMongoUrl(this.options);
    const dbName = resolveMongoDb(url, this.options.mongoDb);
    this.client = new MongoClient(url);
    await this.client.connect();
    this.db = this.client.db(dbName);
    this.collection = this.db.collection(this.collectionName);
  }

  async loadData() {
    const data = {};
    const docs = await this.collection.find({ _id: { $in: KEYS } }).toArray();
    const map = new Map(docs.map((doc) => [doc._id, doc.value]));
    for (const key of KEYS) {
      if (!map.has(key)) {
        data[key] = defaultForKey(key);
        continue;
      }
      const value = map.get(key);
      if (value === undefined) {
        data[key] = defaultForKey(key);
        continue;
      }
      data[key] = cloneValue(value);
    }
    return data;
  }

  async loadMeta() {
    return this.readDoc('meta', { schemaVersion: 0, migrations: [] });
  }

  async saveData(data) {
    for (const key of KEYS) {
      await this.writeDoc(key, data[key] ?? defaultForKey(key));
    }
  }

  async saveMeta(meta) {
    await this.writeDoc('meta', meta);
  }

  async saveLedger(entries) {
    await this.writeDoc('ledger', entries);
  }

  async saveSessions(entries) {
    await this.writeDoc('sessions', entries);
  }

  async savePeers(entries) {
    await this.writeDoc('peers', entries);
  }

  async saveDiscussions(entries) {
    await this.writeDoc('discussions', entries);
  }

  async savePetitions(entries) {
    await this.writeDoc('petitions', entries);
  }

  async saveVotes(entries) {
    await this.writeDoc('votes', entries);
  }

  async saveSignatures(entries) {
    await this.writeDoc('signatures', entries);
  }

  async saveDelegations(entries) {
    await this.writeDoc('delegations', entries);
  }

  async saveNotifications(entries) {
    await this.writeDoc('notifications', entries);
  }

  async saveTopics(entries) {
    await this.writeDoc('topics', entries);
  }

  async saveGroups(entries) {
    await this.writeDoc('groups', entries);
  }

  async saveGroupPolicies(entries) {
    await this.writeDoc('groupPolicies', entries);
  }

  async saveGroupElections(entries) {
    await this.writeDoc('groupElections', entries);
  }

  async saveActors(entries) {
    await this.writeDoc('actors', entries);
  }

  async saveSocialFollows(entries) {
    await this.writeDoc('socialFollows', entries);
  }

  async saveSocialPosts(entries) {
    await this.writeDoc('socialPosts', entries);
  }

  async saveSocialMedia(entries) {
    await this.writeDoc('socialMedia', entries);
  }

  async saveTransactions(entries) {
    await this.writeDoc('transactions', entries);
  }

  async saveTransactionSummaries(entries) {
    await this.writeDoc('transactionSummaries', entries);
  }

  async saveProfileStructures(entries) {
    await this.writeDoc('profileStructures', entries);
  }

  async saveProfileAttributes(entries) {
    await this.writeDoc('profileAttributes', entries);
  }

  async saveSettings(settings) {
    await this.writeDoc('settings', settings);
  }

  async readDoc(key, fallback) {
    const doc = await this.collection.findOne({ _id: key });
    if (!doc || doc.value === undefined) return fallback;
    return cloneValue(doc.value);
  }

  async writeDoc(key, value) {
    await this.collection.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
  }
}

function defaultForKey(key) {
  if (key === 'meta') return { schemaVersion: 0, migrations: [] };
  if (key === 'settings') return { initialized: false };
  return [];
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadMongo() {
  try {
    return await import('mongodb');
  } catch (error) {
    throw new Error(
      'MongoDB adapter requires the optional "mongodb" dependency. Install it and set DATA_ADAPTER=mongodb with DATA_MONGO_URL.',
      { cause: error },
    );
  }
}

function resolveMongoUrl(options = {}) {
  const url = options.mongoUrl || options.url || '';
  if (!url) {
    throw new Error('MongoDB adapter requires DATA_MONGO_URL.');
  }
  return url;
}

function resolveMongoDb(url, provided) {
  if (provided) return provided;
  const fromUrl = extractDbName(url);
  if (!fromUrl) {
    throw new Error('MongoDB adapter requires a database name in DATA_MONGO_URL or DATA_MONGO_DB.');
  }
  return fromUrl;
}

function extractDbName(url) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    return name || '';
  } catch (error) {
    return '';
  }
}

function normalizeName(value, label) {
  const name = String(value || '').trim();
  if (!name) return DEFAULT_COLLECTION;
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`MongoDB adapter ${label} must match [A-Za-z0-9_].`);
  }
  return name;
}

function buildConnectionLabel(options = {}, collection) {
  const url = options.mongoUrl || options.url || '';
  const dbName = options.mongoDb || '';
  if (url) {
    const masked = maskUrl(url);
    return collection ? `${masked}#${collection}` : masked;
  }
  const label = dbName ? `mongodb:///${dbName}` : 'mongodb:///';
  return collection ? `${label}#${collection}` : label;
}

function maskUrl(raw) {
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch (error) {
    return raw.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
  }
}
