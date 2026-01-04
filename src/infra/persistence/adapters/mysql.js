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

const DEFAULT_TABLE = 'state_entries';

export function createMysqlAdapter(options = {}) {
  return new MysqlStateStore(options);
}

class MysqlStateStore {
  constructor(options = {}) {
    this.adapterId = 'mysql';
    this.options = options;
    this.table = normalizeName(options.mysqlTable || options.table || DEFAULT_TABLE, 'table');
    this.pool = null;
    this.connectionLabel = buildConnectionLabel(options, this.table);
  }

  async prepare() {
    const mysql = await loadMysql();
    const { url, config } = resolvePoolConfig(this.options);
    this.pool = url ? mysql.createPool(url) : mysql.createPool(config);
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS \`${this.table}\` (\`key\` VARCHAR(191) PRIMARY KEY, \`value\` LONGTEXT NOT NULL)`,
    );
  }

  async loadData() {
    const data = {};
    const rows = await this.readAll();
    for (const key of KEYS) {
      if (!rows.has(key)) {
        data[key] = defaultForKey(key);
        continue;
      }
      data[key] = parseJson(rows.get(key), defaultForKey(key), key);
    }
    return data;
  }

  async loadMeta() {
    return this.readJson('meta', { schemaVersion: 0, migrations: [] });
  }

  async saveData(data) {
    for (const key of KEYS) {
      await this.writeJson(key, data[key] ?? defaultForKey(key));
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

  async saveTopics(entries) {
    await this.writeJson('topics', entries);
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

  async saveSocialMedia(entries) {
    await this.writeJson('socialMedia', entries);
  }

  async saveTransactions(entries) {
    await this.writeJson('transactions', entries);
  }

  async saveTransactionSummaries(entries) {
    await this.writeJson('transactionSummaries', entries);
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

  async readAll() {
    const [rows] = await this.pool.query(`SELECT \`key\`, \`value\` FROM \`${this.table}\``);
    const map = new Map();
    for (const row of rows || []) {
      map.set(row.key, row.value);
    }
    return map;
  }

  async readJson(key, fallback) {
    const [rows] = await this.pool.query(`SELECT \`value\` FROM \`${this.table}\` WHERE \`key\` = ? LIMIT 1`, [key]);
    if (!rows || rows.length === 0) return fallback;
    return parseJson(rows[0].value, fallback, key);
  }

  async writeJson(key, value) {
    const payload = JSON.stringify(value, null, 0);
    await this.pool.query(
      `INSERT INTO \`${this.table}\` (\`key\`, \`value\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
      [key, payload],
    );
  }
}

function defaultForKey(key) {
  if (key === 'meta') return { schemaVersion: 0, migrations: [] };
  if (key === 'settings') return { initialized: false };
  return [];
}

function parseJson(payload, fallback, key) {
  if (payload === undefined || payload === null) return fallback;
  try {
    const raw = Buffer.isBuffer(payload) ? payload.toString('utf-8') : payload;
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[mysql adapter] Failed to parse key "${key}", using fallback`, error);
    return fallback;
  }
}

async function loadMysql() {
  try {
    const mysql = await import('mysql2/promise');
    return mysql.default || mysql;
  } catch (error) {
    throw new Error(
      'MySQL adapter requires the optional "mysql2" dependency. Install it and set DATA_ADAPTER=mysql with DATA_MYSQL_URL or DATA_MYSQL_HOST settings.',
      { cause: error },
    );
  }
}

function resolvePoolConfig(options = {}) {
  const url = options.mysqlUrl || options.url || '';
  if (url) return { url };
  const host = options.mysqlHost || 'localhost';
  const user = options.mysqlUser || '';
  const database = options.mysqlDatabase || '';
  if (!user || !database) {
    throw new Error('MySQL adapter requires DATA_MYSQL_URL or DATA_MYSQL_USER + DATA_MYSQL_DATABASE.');
  }
  const port = parseNumber(options.mysqlPort);
  const config = {
    host,
    user,
    database,
  };
  if (Number.isFinite(port)) {
    config.port = port;
  }
  if (options.mysqlPassword) {
    config.password = options.mysqlPassword;
  }
  return { config };
}

function normalizeName(value, label) {
  const name = String(value || '').trim();
  if (!name) return DEFAULT_TABLE;
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`MySQL adapter ${label} must match [A-Za-z0-9_].`);
  }
  return name;
}

function buildConnectionLabel(options = {}, table) {
  const url = options.mysqlUrl || options.url || '';
  const database = options.mysqlDatabase || '';
  if (url) {
    const masked = maskUrl(url);
    return table ? `${masked}#${table}` : masked;
  }
  const host = options.mysqlHost || 'localhost';
  const port = options.mysqlPort ? `:${options.mysqlPort}` : '';
  const user = options.mysqlUser ? `${options.mysqlUser}@` : '';
  const dbSuffix = database ? `/${database}` : '';
  const label = `mysql://${user}${host}${port}${dbSuffix}`;
  return table ? `${label}#${table}` : label;
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

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
