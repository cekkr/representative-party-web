import { createSign, createVerify } from 'node:crypto';

import { ISSUER, POLICIES } from '../../config.js';
import { canonicalizeEnvelope } from '../federation/canonical.js';
import { normalizeProviderBlindSettings, resolveRingKeys } from '../circle/ringRegistry.js';
import { getSigningPrivateKey, getSigningPublicKey } from '../circle/signingKeys.js';

export function buildVoteEnvelope(vote, { policy, issuer, providerBlind } = {}) {
  const status = vote.validationStatus === 'preview' ? 'preview' : 'validated';
  const resolvedPolicy = policy || { id: POLICIES.id, version: POLICIES.version };
  const resolvedIssuer = issuer || vote.issuer || ISSUER;
  const payload = {
    issuer: resolvedIssuer,
    policy: {
      id: resolvedPolicy.id || POLICIES.id,
      version: resolvedPolicy.version || POLICIES.version,
    },
    petitionId: vote.petitionId,
    authorHash: vote.authorHash,
    choice: vote.choice,
    createdAt: vote.createdAt,
    status,
  };
  // A delegated ballot's meaning lives in who holds it and until when, not in `choice`
  // (which is just "delegate"). Sign that binding too, so a peer cannot reassign a ballot to
  // a different delegate or quietly extend its window and still present a valid envelope.
  const delegateBinding = normalizeDelegateBinding(vote.delegate);
  if (delegateBinding) {
    payload.delegate = delegateBinding;
  }

  const providerBlindSettings = normalizeProviderBlindSettings(providerBlind || {});
  const ringId = providerBlindSettings.ring.currentId;
  const ringMode = providerBlindSettings.mode || 'off';
  const useRing = ringMode !== 'off' && ringId;
  if (useRing) {
    const ringPayload = {
      policy: payload.policy,
      petitionId: payload.petitionId,
      authorHash: payload.authorHash,
      choice: payload.choice,
      createdAt: payload.createdAt,
      status: payload.status,
      ringId,
    };
    if (delegateBinding) {
      ringPayload.delegate = delegateBinding;
    }
    const ringSignature = signRingPayload(ringPayload);
    if (ringSignature) {
      const ringEnvelope = {
        ...ringPayload,
        ringSignature,
      };
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

export function verifyVoteEnvelope(envelope, { providerBlind } = {}) {
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
  const publicKey = getSigningPublicKey();
  if (signature && publicKey) {
    const verifier = createVerify('sha256');
    verifier.update(JSON.stringify(payload));
    verifier.end();
    const valid = verifier.verify(publicKey, signature, 'base64');
    return { valid, skipped: false, payload };
  }
  return { valid: true, skipped: true, payload };
}

// Only the fields that define the binding are signed, in a fixed key order, so an envelope
// stays byte-stable regardless of how the vote record was assembled.
function normalizeDelegateBinding(delegate) {
  const hash = typeof delegate?.hash === 'string' ? delegate.hash.trim() : '';
  if (!hash) return null;
  return {
    hash,
    via: typeof delegate.via === 'string' && delegate.via ? delegate.via : 'direct',
    at: delegate.at || null,
    deadline: delegate.deadline || null,
  };
}

function signPayload(payload) {
  const privateKey = getSigningPrivateKey();
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function signRingPayload(payload) {
  const privateKey = getSigningPrivateKey();
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
