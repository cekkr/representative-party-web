import { createSign, createVerify } from 'node:crypto';

import { POLICIES } from '../config.js';

const ISSUER = process.env.CIRCLE_ISSUER || 'local-circle';

export function buildVoteEnvelope(vote) {
  const payload = {
    issuer: ISSUER,
    policy: {
      id: POLICIES.id,
      version: POLICIES.version,
    },
    petitionId: vote.petitionId,
    authorHash: vote.authorHash,
    choice: vote.choice,
    createdAt: vote.createdAt,
  };
  const signature = signPayload(payload);
  return signature ? { ...payload, signature } : payload;
}

export function verifyVoteEnvelope(envelope) {
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

function signPayload(payload) {
  const privateKey = process.env.CIRCLE_PRIVATE_KEY;
  if (!privateKey) return null;
  const signer = createSign('sha256');
  signer.update(JSON.stringify(payload));
  signer.end();
  return signer.sign(privateKey, 'base64');
}
