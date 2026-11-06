import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'md-assets', 'party');

function start(command, args, env, stdio, signal) {
  const child = spawn(command, args, { cwd: root, env, stdio, signal });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, reason) => resolve(code ?? reason));
  });
  return { child, done };
}

async function listening(server) {
  const lines = createInterface({ input: server.child.stdout });
  let timeout;
  try {
    return await Promise.race([
      new Promise((resolve) => {
        lines.on('line', (line) => {
          const match = line.match(/^Organization Web server running at (http:\/\/127\.0\.0\.1:\d+)$/);
          if (match) resolve(match[1]);
        });
      }),
      server.done.then((code) => { throw new Error(`Scenario A server exited before listening (${code}).`); }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out starting the Scenario A server.')), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    lines.close();
    server.child.stdout.resume();
  }
}

async function main() {
  const temp = await mkdtemp(path.join(tmpdir(), 'weborg-readme-'));
  const captures = path.join(temp, 'captures');
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  const server = start('bash', ['run-standalone.sh'], {
    PATH: process.env.PATH,
    DOTENV_CONFIG_PATH: '/dev/null',
    HOST: '127.0.0.1',
    PORT: '0',
    STANDALONE_DIR: path.join(temp, 'store'),
    SOCIAL_MEDIA_UPLOADS_ROOT: path.join(temp, 'uploads'),
    ENFORCE_CIRCLE: 'true',
    CIRCLE_POLICY_ID: 'rete-civica-nazionale',
    CIRCLE_NAME: 'Rete Civica Nazionale',
    DATA_VALIDATION_LEVEL: 'strict',
    DATA_PREVIEW: 'false',
  }, ['ignore', 'pipe', 'inherit']);

  try {
    const baseUrl = await listening(server);
    abort.signal.throwIfAborted();
    const journey = start(process.execPath, ['scripts/party-journeys.js'], {
      ...process.env,
      BASE_URL: baseUrl,
      OUT_DIR: captures,
      ADMIN_SESSION: 'admin',
      ADMIN_PASSWORD: 'admin',
      ONLY: '',
      KEEP: '0',
    }, 'inherit', abort.signal);
    const result = await journey.done;
    if (result !== 0) throw new Error(`Scenario A capture failed (${result}).`);

    const readme = await readFile(path.join(root, 'README.md'), 'utf8');
    const expected = new Set([...readme.matchAll(/\bmd-assets\/party\/([\w-]+\.png)\b/g)].map(([, file]) => file));
    const actual = (await readdir(captures)).filter((file) => file.endsWith('.png'));
    const missing = [...expected].filter((file) => !actual.includes(file));
    const extra = actual.filter((file) => !expected.has(file));
    if (!expected.size || missing.length || extra.length) {
      throw new Error(`README and captures differ. Missing: ${missing.join(', ') || 'none'}. Unlinked: ${extra.join(', ') || 'none'}.`);
    }
    for (const file of actual) {
      await copyFile(path.join(captures, file), path.join(assets, file));
    }
    console.log(`Refreshed ${actual.length} README screenshots in md-assets/party.`);
  } finally {
    server.child.kill();
    await server.done.catch(() => {});
    await rm(temp, { recursive: true, force: true });
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
