#!/usr/bin/env node
import { createHash, generateKeyPairSync } from 'node:crypto';

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.help) {
  printUsage();
  process.exit(0);
}

const keyPair = generateKeyPairSync(options.type, options.type === 'rsa' ? { modulusLength: options.bits } : { namedCurve: options.curve });
const privatePem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
const privateEnv = toEnvValue(privatePem);
const publicEnv = toEnvValue(publicPem);
const fingerprint = createHash('sha256').update(publicPem.trim()).digest('hex').slice(0, 12);

console.log('# Circle signing keys (PEM)');
console.log(privatePem.trim());
console.log('');
console.log(publicPem.trim());
console.log('');
console.log('# .env-ready values');
console.log(`CIRCLE_PRIVATE_KEY="${privateEnv}"`);
console.log(`CIRCLE_PUBLIC_KEY="${publicEnv}"`);
console.log('');
console.log('# Keep private keys secret and out of version control.');
console.log('');
console.log(`# Public key fingerprint: ${fingerprint}`);
console.log('');

if (options.libp2p) {
  await printLibp2pIdentity();
}

function parseArgs(argv) {
  const options = {
    type: 'ec',
    curve: 'prime256v1',
    bits: 2048,
    libp2p: true,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--rsa') {
      options.type = 'rsa';
      continue;
    }
    if (arg === '--ec') {
      options.type = 'ec';
      continue;
    }
    if (arg === '--no-libp2p') {
      options.libp2p = false;
      continue;
    }
    if (arg === '--libp2p') {
      options.libp2p = true;
      continue;
    }
    if (arg.startsWith('--bits=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value >= 1024) {
        options.bits = value;
      }
      continue;
    }
    if (arg.startsWith('--curve=')) {
      const value = arg.split('=')[1];
      if (value) {
        options.curve = value;
      }
    }
  }
  return options;
}

function toEnvValue(pem) {
  return String(pem || '').trim().replace(/\n/g, '\\n');
}

async function printLibp2pIdentity() {
  try {
    const { generateKeyPair, privateKeyToProtobuf, publicKeyToProtobuf } = await import('@libp2p/crypto/keys');
    const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
    const privateKey = await generateKeyPair('Ed25519');
    const peerId = peerIdFromPrivateKey(privateKey).toString();
    const privateBytes = privateKeyToProtobuf(privateKey);
    const publicBytes = publicKeyToProtobuf(privateKey.publicKey);
    const privateB64 = Buffer.from(privateBytes).toString('base64');
    const publicB64 = Buffer.from(publicBytes).toString('base64');

    console.log('# Optional libp2p ring identity (for provider-blind ring IDs)');
    console.log(`CIRCLE_RING_ID="${peerId}"`);
    console.log(`CIRCLE_RING_PRIVATE_KEY="${privateB64}"`);
    console.log(`CIRCLE_RING_PUBLIC_KEY="${publicB64}"`);
    console.log('# Set CIRCLE_RING_ID to prefill /admin -> Provider-blind mode ring ID.');
  } catch (error) {
    console.log('# libp2p ring identity unavailable (install @libp2p/crypto and @libp2p/peer-id)');
    console.log(`# ${error?.message || error}`);
  }
}

function printUsage() {
  console.log('Usage: node scripts/circle-keygen.js [--rsa|--ec] [--bits=2048] [--curve=prime256v1] [--no-libp2p]');
  console.log('');
  console.log('Defaults:');
  console.log('  --ec (prime256v1) signing keys');
  console.log('  libp2p ring identity output enabled');
}
