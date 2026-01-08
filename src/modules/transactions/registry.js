import { createHash, createSign, createVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { ISSUER } from '../../config.js';
import { persistTransactions } from '../../infra/persistence/storage.js';
import { canonicalizeEnvelope } from '../federation/canonical.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';
import { getReplicationProfile } from '../federation/replication.js';
import { getEffectivePolicy } from '../circle/policy.js';
import { getProviderBlindSettings, normalizeProviderBlindSettings, resolveRingKeys } from '../circle/ringRegistry.js';

export function hashPayload(payload) {
  const serialized = JSON.stringify(payload || {});
  return createHash('sha256').update(serialized).digest('hex');
}

export async function logTransaction(state, entry = {}) {
  const now = new Date().toISOString();
  const digest = hashPayload({ type: entry.type, payload: entry.payload, issuer: state.issuer });
  const stamped = stampLocalEntry(state, {
    id: entry.id || randomUUID(),
    type: entry.type || 'generic',
    actorHash: entry.actorHash || null,
    petitionId: entry.petitionId || null,
    payload: entry.payload || {},
    digest,
    validationStatus: entry.validationStatus || 'validated',
    createdAt: entry.createdAt || now,
  });
  state.transactions = [stamped, ...(state.transactions || [])].slice(0, 500);
  await persistTransactions(state);
  return stamped;
}

export function listTransactions(state, { type, limit = 50 } = {}) {
  const filtered = filterVisibleEntries(state.transactions || [], state);
  const narrowed = type ? filtered.filter((t) => t.type === type) : filtered;
  return narrowed.slice(0, limit);
}

export function exportTransactionsEnvelope(state, { limit = 100 } = {}) {
  const profile = getReplicationProfile(state);
  const policy = getEffectivePolicy(state);
  const entries = listTransactions(state, { limit });
  const hasPreview = entries.some((entry) => entry.validationStatus === 'preview');
  const status = hasPreview ? 'preview' : 'validated';
  const digestList = entries.map((t) => t.digest);
  const summary = hashPayload({ digests: digestList, issuer: state.issuer || ISSUER });
  const payload = {
    id: `transactions-${Date.now()}`,
    issuer: state.issuer || ISSUER,
    issuedAt: new Date().toISOString(),
    profile,
    policy: {
      id: policy.id,
      version: policy.version,
    },
    status,
    summary,
    entries: entries.map((t) => ({
      id: t.id,
      type: t.type,
      petitionId: t.petitionId || null,
      actorHash: t.actorHash || null,
      digest: t.digest,
      createdAt: t.createdAt,
    })),
  };

  const providerBlind = getProviderBlindSettings(state);
  const ringId = providerBlind.ring.currentId;
  const ringMode = providerBlind.mode || 'off';
  const useRing = ringMode !== 'off' && ringId;
  if (useRing) {
    const ringPayload = {
      id: payload.id,
      issuedAt: payload.issuedAt,
      profile: payload.profile,
      policy: payload.policy,
      status: payload.status,
      summary: payload.summary,
      entries: payload.entries,
      ringId,
    };
    const ringSignature = signRingPayload(ringPayload);
    if (ringSignature) {
      const ringEnvelope = { ...ringPayload, ringSignature };
      if (ringMode === 'observe') {
        const signature = signPayload(payload);
        return signature ? { ...payload, ...ringEnvelope, signature } : { ...payload, ...ringEnvelope };
      }
      return ringEnvelope;
    }
  }

  const signature = signPayload(payload);
  return signature ? { ...payload, signature } : payload;
}

export function verifyTransactionsEnvelope(envelope, { providerBlind } = {}) {
  const payload = { ...envelope };
  delete payload.signature;
  delete payload.ringSignature;
  delete payload.issuerEscrow;

  const providerBlindSettings = normalizeProviderBlindSettings(providerBlind || {});
  const ringMode = providerBlindSettings.mode || 'off';
  if (envelope?.ringSignature) {
    const ringResult = verifyRingSignature(envelope, providerBlindSettings);
    if (!ringResult.skipped || ringMode === 'strict') {
      return ringResult.skipped && ringMode === 'strict'
        ? { valid: false, skipped: false, payload }
        : ringResult;
    }
  } else if (ringMode === 'strict') {
    return { valid: false, skipped: false, payload };
  }

  const signature = envelope?.signature;
  const publicKey = process.env.CIRCLE_PUBLIC_KEY;
  if (signature && publicKey) {
    const verifier = createVerify('sha256');
    verifier.update(JSON.stringify(payload));
    verifier.end();
    const valid = verifier.verify(publicKey, signature, 'base64');
    return { valid, skipped: false, payload };
  }

  return { valid: true, skipped: true, payload };
}

function signPayload(payload) {
  const privateKey = process.env.CIRCLE_PRIVATE_KEY;
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function signRingPayload(payload) {
  const privateKey = process.env.CIRCLE_PRIVATE_KEY;
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(canonicalizeEnvelope(payload, { omitKeys: ['ringSignature', 'issuerEscrow', 'signature', 'issuer'] }));
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function verifyRingSignature(envelope, providerBlindSettings) {
  const ringSignature = envelope?.ringSignature;
  const ringId = envelope?.ringId;
  const payload = { ...envelope };
  delete payload.signature;
  delete payload.ringSignature;
  delete payload.issuerEscrow;
  delete payload.issuer;

  if (!ringSignature || !ringId) {
    return { valid: true, skipped: true, payload };
  }

  const keys = resolveRingKeys(providerBlindSettings, ringId);
  if (!keys.length) {
    return { valid: true, skipped: true, payload };
  }
  const message = canonicalizeEnvelope(envelope, { omitKeys: ['ringSignature', 'issuerEscrow', 'signature', 'issuer'] });
  for (const key of keys) {
    const normalizedKey = normalizeRingKey(key);
    if (!normalizedKey) continue;
    try {
      const verifier = createVerify('sha256');
      verifier.update(message);
      verifier.end();
      if (verifier.verify(normalizedKey, ringSignature, 'base64')) {
        return { valid: true, skipped: false, payload };
      }
    } catch (_error) {
      continue;
    }
  }
  return { valid: false, skipped: false, payload };
}

function normalizeRingKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (text.includes('\\n')) {
    return text.replace(/\\n/g, '\n');
  }
  return text;
}
