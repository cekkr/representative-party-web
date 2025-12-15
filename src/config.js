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
  EXTENSIONS_ROOT: join(ROOT_DIR, 'extensions'),
};

export const FILES = {
  ledger: join(PATHS.DATA_ROOT, 'ledger.json'),
  sessions: join(PATHS.DATA_ROOT, 'sessions.json'),
  peers: join(PATHS.DATA_ROOT, 'peers.json'),
  discussions: join(PATHS.DATA_ROOT, 'discussions.json'),
  actors: join(PATHS.DATA_ROOT, 'actors.json'),
  meta: join(PATHS.DATA_ROOT, 'meta.json'),
  settings: join(PATHS.DATA_ROOT, 'settings.json'),
};

export const DEFAULT_PAGE_TITLE = 'Representative Party';
