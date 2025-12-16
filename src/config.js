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

export const PATHS = {
  ROOT: ROOT_DIR,
  PUBLIC_ROOT: join(ROOT_DIR, 'public'),
  TEMPLATE_ROOT: join(ROOT_DIR, 'public', 'templates'),
  DATA_ROOT: join(ROOT_DIR, 'data'),
  EXTENSIONS_ROOT: join(ROOT_DIR, 'modules', 'extensions'),
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
  meta: join(PATHS.DATA_ROOT, 'meta.json'),
  settings: join(PATHS.DATA_ROOT, 'settings.json'),
};

export const DEFAULT_PAGE_TITLE = 'Representative Party';
