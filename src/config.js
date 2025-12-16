import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));

export const HOST = process.env.HOST || '0.0.0.0';
export const PORT = process.env.PORT || 3000;

export const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

export const POLICIES = {
  id: process.env.CIRCLE_POLICY_ID || 'party-circle-alpha',
  version: 1,
  requireVerification: true,
  enforceCircle: process.env.ENFORCE_CIRCLE === 'true',
  gossipIntervalSeconds: Number(process.env.GOSSIP_INTERVAL_SECONDS || 300),
};

export const DATA_DEFAULTS = {
  mode: 'centralized',
  adapter: 'json',
  validationLevel: 'strict',
  allowPreviews: false,
};

export const PATHS = {
  ROOT: ROOT_DIR,
  PUBLIC_ROOT: join(ROOT_DIR, 'public'),
  TEMPLATE_ROOT: join(ROOT_DIR, 'public', 'templates'),
  DATA_ROOT: join(ROOT_DIR, 'data'),
  EXTENSIONS_ROOT: join(ROOT_DIR, 'modules', 'extensions'),
  DATA_SQLITE: join(ROOT_DIR, 'data', 'state.sqlite'),
  DATA_KV: join(ROOT_DIR, 'data', 'kv-store.json'),
};

export const FILES = {
  ledger: join(PATHS.DATA_ROOT, 'ledger.json'),
  sessions: join(PATHS.DATA_ROOT, 'sessions.json'),
  peers: join(PATHS.DATA_ROOT, 'peers.json'),
  discussions: join(PATHS.DATA_ROOT, 'discussions.json'),
  petitions: join(PATHS.DATA_ROOT, 'petitions.json'),
  signatures: join(PATHS.DATA_ROOT, 'signatures.json'),
  votes: join(PATHS.DATA_ROOT, 'votes.json'),
  delegations: join(PATHS.DATA_ROOT, 'delegations.json'),
  notifications: join(PATHS.DATA_ROOT, 'notifications.json'),
  groups: join(PATHS.DATA_ROOT, 'groups.json'),
  groupPolicies: join(PATHS.DATA_ROOT, 'group-policies.json'),
  groupElections: join(PATHS.DATA_ROOT, 'group-elections.json'),
  actors: join(PATHS.DATA_ROOT, 'actors.json'),
  socialFollows: join(PATHS.DATA_ROOT, 'social-follows.json'),
  socialPosts: join(PATHS.DATA_ROOT, 'social-posts.json'),
  meta: join(PATHS.DATA_ROOT, 'meta.json'),
  settings: join(PATHS.DATA_ROOT, 'settings.json'),
};

export const DATA = {
  mode: normalizeDataMode(process.env.DATA_MODE),
  adapter: normalizeDataAdapter(process.env.DATA_ADAPTER),
  validationLevel: normalizeValidationLevel(process.env.DATA_VALIDATION_LEVEL),
  allowPreviews: parseBooleanEnv(process.env.DATA_PREVIEW, DATA_DEFAULTS.allowPreviews),
  sqliteFile: resolveSqliteFilename(),
  kvFile: process.env.DATA_KV_FILE || PATHS.DATA_KV,
};

export const DEFAULT_PAGE_TITLE = 'Representative Party';

export function normalizeDataMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hybrid' || normalized === 'p2p') return normalized;
  if (normalized === 'centralized') return 'centralized';
  return DATA_DEFAULTS.mode;
}

export function normalizeValidationLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'observe' || normalized === 'observing' || normalized === 'lenient') return 'observe';
  if (normalized === 'off') return 'off';
  return DATA_DEFAULTS.validationLevel;
}

export function normalizeDataAdapter(value) {
  if (!value) return DATA_DEFAULTS.adapter;
  return String(value).trim().toLowerCase();
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function resolveSqliteFilename() {
  const url = process.env.DATA_SQLITE_URL || '';
  const file = process.env.DATA_SQLITE_FILE || '';
  if (file) return file;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:' || parsed.protocol === 'sqlite:') {
        return parsed.pathname || PATHS.DATA_SQLITE;
      }
    } catch (error) {
      // fall through to default
    }
  }
  return PATHS.DATA_SQLITE;
}
