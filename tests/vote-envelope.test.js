import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { buildVoteEnvelope, verifyVoteEnvelope } from '../src/modules/votes/voteEnvelope.js';

test('vote envelopes are signed and verified when keys are available', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  process.env.CIRCLE_PUBLIC_KEY = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  const vote = {
    petitionId: 'petition-1',
    authorHash: 'person-1',
    choice: 'yes',
    createdAt: '2024-01-01T00:00:00.000Z',
    validationStatus: 'validated',
  };
  const envelope = buildVoteEnvelope(vote, { issuer: 'local' });
  const result = verifyVoteEnvelope(envelope);

  process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
  process.env.CIRCLE_PUBLIC_KEY = prevPublic;

  assert.ok(envelope.signature, 'expected envelope signature');
  assert.equal(envelope.status, 'validated');
  assert.equal(result.valid, true);
  assert.equal(result.skipped, false);
  assert.equal(result.payload.choice, 'yes');
});

test('vote envelopes preserve preview status for preview votes', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const prevPrivate = process.env.CIRCLE_PRIVATE_KEY;
  const prevPublic = process.env.CIRCLE_PUBLIC_KEY;
  process.env.CIRCLE_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  process.env.CIRCLE_PUBLIC_KEY = publicKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  const vote = {
    petitionId: 'petition-2',
    authorHash: 'person-2',
    choice: 'no',
    createdAt: '2024-01-02T00:00:00.000Z',
    validationStatus: 'preview',
  };
  const envelope = buildVoteEnvelope(vote, { issuer: 'local' });
  const result = verifyVoteEnvelope(envelope);

  process.env.CIRCLE_PRIVATE_KEY = prevPrivate;
  process.env.CIRCLE_PUBLIC_KEY = prevPublic;

  assert.equal(envelope.status, 'preview');
  assert.equal(result.valid, true);
  assert.equal(result.skipped, false);
});
