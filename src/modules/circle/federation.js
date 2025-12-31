import { createHash, createSign, createVerify } from 'node:crypto';

import { ISSUER, POLICIES } from '../../config.js';
import { getEffectivePolicy } from './policy.js';

export function computeLedgerHash(entries = []) {
  const normalized = [...(entries || [])].map((entry) => String(entry));
  normalized.sort();
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function buildLedgerEnvelope(state) {
  const policy = getEffectivePolicy(state);
  const issuer = state?.issuer || ISSUER;
  const entries = [...state.uniquenessLedger].map((entry) => String(entry)).sort();
  const envelope = {
    id: `ledger-${Date.now()}`,
    issuer,
    issuedAt: new Date().toISOString(),
    status: 'validated',
    policy: {
      id: policy.id || POLICIES.id,
      version: policy.version || POLICIES.version,
      enforcement: policy.enforceCircle ? 'strict' : 'observing',
    },
    entries,
    ledgerHash: computeLedgerHash(entries),
    peers: [...state.peers],
  };

  const signature = signEnvelope(envelope);
  if (signature) {
    return { ...envelope, signature };
  }
  return envelope;
}

export function verifyLedgerEnvelope(envelope) {
  const signature = envelope?.signature;
  const publicKey = process.env.CIRCLE_PUBLIC_KEY;
  const payload = { ...envelope };
  delete payload.signature;

  if (signature && publicKey) {
    const verifier = createVerify('sha256');
    verifier.update(JSON.stringify(payload));
    verifier.end();
    const valid = verifier.verify(publicKey, signature, 'base64');
    return { valid, skipped: false, payload };
  }

  return { valid: true, skipped: true, payload };
}

function signEnvelope(payload) {
  const privateKey = process.env.CIRCLE_PRIVATE_KEY;
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKey, 'base64');
}
