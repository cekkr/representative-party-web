import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSigningKeyPair,
  getSigningPrivateKey,
  getSigningPublicKey,
  resolveSigningKeys,
} from '../src/modules/circle/signingKeys.js';
import { buildVoteEnvelope, verifyVoteEnvelope } from '../src/modules/votes/voteEnvelope.js';

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('a key path is rejected instead of being reported as a loaded key', () => {
  // run-standalone.sh used to export the file path rather than the PEM text.
  withEnv(
    {
      CIRCLE_PRIVATE_KEY: '/srv/circle/keys/circle-private.pem',
      CIRCLE_PUBLIC_KEY: '/srv/circle/keys/circle-public.pem',
    },
    () => {
      const info = resolveSigningKeys({ settings: {} });
      assert.equal(info.hasPrivate, false, 'a path must not count as a private key');
      assert.equal(info.hasPublic, false, 'a path must not count as a public key');
      assert.equal(info.source, 'missing');
      assert.equal(info.fingerprint, '', 'must not fingerprint a non-key');
      assert.deepEqual(info.malformed, ['CIRCLE_PRIVATE_KEY', 'CIRCLE_PUBLIC_KEY']);
      assert.equal(getSigningPrivateKey(), '');
      assert.equal(getSigningPublicKey(), '');
    },
  );
});

test('a malformed key degrades to an unsigned envelope rather than throwing', () => {
  withEnv(
    { CIRCLE_PRIVATE_KEY: '/srv/circle/keys/circle-private.pem', CIRCLE_PUBLIC_KEY: undefined },
    () => {
      const vote = {
        petitionId: 'petition-1',
        authorHash: 'hash-1',
        choice: 'yes',
        createdAt: new Date().toISOString(),
      };
      // Previously this reached OpenSSL and raised DECODER routines::unsupported,
      // surfacing as a 500 when casting a vote.
      const envelope = buildVoteEnvelope(vote, {});
      assert.equal(envelope.signature, undefined, 'no signature without a usable key');
      assert.equal(envelope.petitionId, 'petition-1');
    },
  );
});

test('real PEM keys still sign and verify', () => {
  const { privateKey, publicKey } = generateSigningKeyPair();
  withEnv({ CIRCLE_PRIVATE_KEY: privateKey, CIRCLE_PUBLIC_KEY: publicKey }, () => {
    const info = resolveSigningKeys({ settings: {} });
    assert.equal(info.hasPrivate, true);
    assert.equal(info.hasPublic, true);
    assert.deepEqual(info.malformed, []);
    assert.match(info.fingerprint, /^[0-9a-f]{12}$/);

    const vote = {
      petitionId: 'petition-2',
      authorHash: 'hash-2',
      choice: 'no',
      createdAt: new Date().toISOString(),
    };
    const envelope = buildVoteEnvelope(vote, {});
    assert.ok(envelope.signature, 'a usable key must produce a signature');
    assert.equal(verifyVoteEnvelope(envelope, {}).valid, true);
  });
});

test('PEM with escaped newlines normalizes identically to real newlines', () => {
  const { publicKey } = generateSigningKeyPair();
  const escaped = withEnv({ CIRCLE_PUBLIC_KEY: publicKey.replace(/\n/g, '\\n') }, () => getSigningPublicKey());
  const literal = withEnv({ CIRCLE_PUBLIC_KEY: publicKey }, () => getSigningPublicKey());

  assert.ok(escaped, 'escaped-newline PEM must be accepted');
  assert.equal(escaped, literal, 'both spellings must normalize to the same key text');

  const fingerprintOf = (key) => withEnv({ CIRCLE_PUBLIC_KEY: key }, () => resolveSigningKeys({ settings: {} }).fingerprint);
  assert.equal(
    fingerprintOf(publicKey.replace(/\n/g, '\\n')),
    fingerprintOf(publicKey),
    'the same key must fingerprint the same however it was passed in',
  );
});
