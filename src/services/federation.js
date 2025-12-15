import { createSign, createVerify } from 'node:crypto';

import { POLICIES } from '../config.js';

const ISSUER = process.env.CIRCLE_ISSUER || 'local-circle';

export function buildLedgerEnvelope(state) {
  const envelope = {
    id: `ledger-${Date.now()}`,
    issuer: ISSUER,
    issuedAt: new Date().toISOString(),
    policy: {
      id: POLICIES.id,
      version: POLICIES.version,
      enforcement: POLICIES.enforceCircle ? 'strict' : 'observing',
    },
    entries: [...state.uniquenessLedger],
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
