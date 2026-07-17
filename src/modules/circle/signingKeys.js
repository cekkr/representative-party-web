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
  const malformed = [
    isMalformedPem(process.env.CIRCLE_PRIVATE_KEY) ? 'CIRCLE_PRIVATE_KEY' : null,
    isMalformedPem(process.env.CIRCLE_PUBLIC_KEY) ? 'CIRCLE_PUBLIC_KEY' : null,
    isMalformedPem(stored.privateKey) ? 'settings.signingKeys.privateKey' : null,
    isMalformedPem(stored.publicKey) ? 'settings.signingKeys.publicKey' : null,
  ].filter(Boolean);
  return {
    privateKey,
    publicKey,
    source,
    fingerprint,
    malformed,
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

/**
 * Signing/verification key from the environment, or '' when it is unset or not
 * PEM text. Callers treat '' as "no key configured" and fall back to unsigned
 * envelopes, so a misconfigured key degrades instead of throwing from OpenSSL.
 */
export function getSigningPrivateKey() {
  return normalizePem(process.env.CIRCLE_PRIVATE_KEY || '');
}

export function getSigningPublicKey() {
  return normalizePem(process.env.CIRCLE_PUBLIC_KEY || '');
}

export function fingerprintPublicKey(publicKey = '') {
  const normalized = normalizePem(publicKey);
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/;

/**
 * Accepts PEM text only. A value that is set but is not a PEM block (a file
 * path, for example) resolves to '' so callers report the key as missing
 * instead of advertising it as loaded and failing later inside OpenSSL.
 */
function normalizePem(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  // Trim again after expanding: the same key written with escaped newlines must
  // normalize to the same text as one with real newlines, or it fingerprints
  // differently depending on how it was passed in.
  const expanded = (text.includes('\\n') ? text.replace(/\\n/g, '\n') : text).trim();
  return PEM_BLOCK.test(expanded) ? expanded : '';
}

/** True when a value was provided but is not usable PEM. */
function isMalformedPem(value = '') {
  return Boolean(String(value || '').trim()) && !normalizePem(value);
}
