import { createHash, generateKeyPairSync } from 'node:crypto';

const DEFAULT_ALGORITHM = 'ec';
const DEFAULT_CURVE = 'prime256v1';

export function generateSigningKeyPair({ algorithm = DEFAULT_ALGORITHM, curve = DEFAULT_CURVE } = {}) {
  const options = algorithm === 'rsa' ? { modulusLength: 2048 } : { namedCurve: curve };
  const { privateKey, publicKey } = generateKeyPairSync(algorithm, options);
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    algorithm,
    curve: algorithm === 'ec' ? curve : undefined,
  };
}

export function resolveSigningKeys(state) {
  const stored = state?.settings?.signingKeys || {};
  const storedPrivate = normalizePem(stored.privateKey || '');
  const storedPublic = normalizePem(stored.publicKey || '');
  const envPrivate = normalizePem(process.env.CIRCLE_PRIVATE_KEY || '');
  const envPublic = normalizePem(process.env.CIRCLE_PUBLIC_KEY || '');
  const privateKey = envPrivate || storedPrivate;
  const publicKey = envPublic || storedPublic;
  const source = envPrivate || envPublic ? 'env' : storedPrivate || storedPublic ? 'settings' : 'missing';
  const fingerprint = publicKey ? fingerprintPublicKey(publicKey) : '';
  return {
    privateKey,
    publicKey,
    source,
    fingerprint,
    hasPrivate: Boolean(privateKey),
    hasPublic: Boolean(publicKey),
    env: { privateKey: envPrivate, publicKey: envPublic },
    stored: { privateKey: storedPrivate, publicKey: storedPublic },
  };
}

export function ensureSigningKeysInEnv(state) {
  const stored = state?.settings?.signingKeys || {};
  applySigningKeysToEnv(stored, { force: false });
}

export function applySigningKeysToEnv(keys = {}, { force = false } = {}) {
  const privateKey = normalizePem(keys.privateKey || '');
  const publicKey = normalizePem(keys.publicKey || '');
  if (privateKey && (force || !process.env.CIRCLE_PRIVATE_KEY)) {
    process.env.CIRCLE_PRIVATE_KEY = privateKey;
  }
  if (publicKey && (force || !process.env.CIRCLE_PUBLIC_KEY)) {
    process.env.CIRCLE_PUBLIC_KEY = publicKey;
  }
}

export function fingerprintPublicKey(publicKey = '') {
  const normalized = normalizePem(publicKey);
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function normalizePem(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.includes('\\n')) {
    return text.replace(/\\n/g, '\n');
  }
  return text;
}
