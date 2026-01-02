#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
ADMIN_SESSION_ID="${ADMIN_SESSION_ID:-$ADMIN_USER}"

STANDALONE_DIR="${STANDALONE_DIR:-$ROOT_DIR/.local/standalone}"
STANDALONE_KV_FILE="${STANDALONE_KV_FILE:-$STANDALONE_DIR/kv-store.json}"
STANDALONE_KEY_DIR="${STANDALONE_KEY_DIR:-$STANDALONE_DIR/keys}"
STANDALONE_PRIVATE_KEY="${STANDALONE_PRIVATE_KEY:-$STANDALONE_KEY_DIR/circle-private.pem}"
STANDALONE_PUBLIC_KEY="${STANDALONE_PUBLIC_KEY:-$STANDALONE_KEY_DIR/circle-public.pem}"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Seed a standalone KV store with an admin session and all modules enabled.
STANDALONE_KV_FILE="$STANDALONE_KV_FILE" \
ADMIN_USER="$ADMIN_USER" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
ADMIN_SESSION_ID="$ADMIN_SESSION_ID" \
node --input-type=module <<'NODE'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { listModuleDefinitions } from './src/modules/circle/modules.js';

const kvFile = process.env.STANDALONE_KV_FILE;
const adminUser = process.env.ADMIN_USER || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const sessionId = process.env.ADMIN_SESSION_ID || adminUser;

mkdirSync(dirname(kvFile), { recursive: true });

let store = {};
try {
  store = JSON.parse(readFileSync(kvFile, 'utf-8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const sessions = Array.isArray(store.sessions) ? store.sessions : [];
const sessionIndex = sessions.findIndex((entry) => (entry?.id || entry?.sessionId || entry?.sid) === sessionId);
const issuedAt = Date.now();
const baseSession = {
  id: sessionId,
  status: 'pending',
  issuedAt,
  salt: adminPassword,
  role: 'admin',
  handle: adminUser,
  banned: false,
};

if (sessionIndex === -1) {
  sessions.push(baseSession);
} else {
  const existing = sessions[sessionIndex] || {};
  sessions[sessionIndex] = {
    ...existing,
    id: existing.id || sessionId,
    status: existing.status || baseSession.status,
    issuedAt: existing.issuedAt || issuedAt,
    salt: existing.salt || baseSession.salt,
    role: 'admin',
    handle: adminUser,
    banned: Boolean(existing.banned),
  };
}

const modules = {};
for (const definition of listModuleDefinitions()) {
  modules[definition.key] = true;
}

store.sessions = sessions;
store.settings = {
  ...(store.settings || {}),
  initialized: true,
  modules,
};

writeFileSync(kvFile, JSON.stringify(store, null, 2));
NODE

if [ -z "${CIRCLE_PRIVATE_KEY:-}" ] && [ -z "${CIRCLE_PUBLIC_KEY:-}" ]; then
  if [ ! -s "$STANDALONE_PRIVATE_KEY" ] || [ ! -s "$STANDALONE_PUBLIC_KEY" ]; then
    mkdir -p "$STANDALONE_KEY_DIR"
    STANDALONE_PRIVATE_KEY="$STANDALONE_PRIVATE_KEY" \
    STANDALONE_PUBLIC_KEY="$STANDALONE_PUBLIC_KEY" \
    node --input-type=module <<'NODE'
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const privatePath = process.env.STANDALONE_PRIVATE_KEY;
const publicPath = process.env.STANDALONE_PUBLIC_KEY;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(privatePath, privateKey.export({ type: 'pkcs1', format: 'pem' }));
writeFileSync(publicPath, publicKey.export({ type: 'pkcs1', format: 'pem' }));
NODE
  fi
  export CIRCLE_PRIVATE_KEY="$STANDALONE_PRIVATE_KEY"
  export CIRCLE_PUBLIC_KEY="$STANDALONE_PUBLIC_KEY"
else
  if [ -z "${CIRCLE_PRIVATE_KEY:-}" ] || [ -z "${CIRCLE_PUBLIC_KEY:-}" ]; then
    echo "Warning: set both CIRCLE_PRIVATE_KEY and CIRCLE_PUBLIC_KEY for vote envelope signing."
  fi
fi

export DATA_MODE="centralized"
export DATA_ADAPTER="kv"
export DATA_KV_FILE="$STANDALONE_KV_FILE"
export DATA_VALIDATION_LEVEL="${DATA_VALIDATION_LEVEL:-observe}"
export DATA_PREVIEW="${DATA_PREVIEW:-true}"

LOCAL_HOST="$HOST"
if [ "$HOST" = "0.0.0.0" ] || [ "$HOST" = "::" ]; then
  LOCAL_HOST="127.0.0.1"
fi

ENCODED_SESSION_ID="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$ADMIN_SESSION_ID")"
ENCODED_PASSWORD="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$ADMIN_PASSWORD")"
BASE_URL="http://$LOCAL_HOST:$PORT"
LOGIN_URL="$BASE_URL/auth/callback?session=$ENCODED_SESSION_ID&pidHash=$ENCODED_PASSWORD"

cat <<EOF
Standalone server starting...
- Data store: $DATA_KV_FILE
- Admin user: $ADMIN_USER
- Admin password: $ADMIN_PASSWORD
- Admin login: $LOGIN_URL
- Admin panel: $BASE_URL/admin
EOF

exec node "$ROOT_DIR/src/index.js"
