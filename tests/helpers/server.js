import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

export async function startServer({
  port,
  host = '127.0.0.1',
  dataAdapter = 'memory',
  dataMode = 'centralized',
  dataValidation = 'strict',
  allowPreviews = false,
  kvFile,
  sqliteFile,
  extraEnv = {},
} = {}) {
  if (!port) throw new Error('startServer requires a port');
  const env = {
    ...process.env,
    HOST: host,
    PORT: String(port),
    DATA_ADAPTER: dataAdapter,
    DATA_MODE: dataMode,
    DATA_VALIDATION_LEVEL: dataValidation,
    DATA_PREVIEW: allowPreviews ? 'true' : 'false',
    ...extraEnv,
  };
  if (kvFile) env.DATA_KV_FILE = kvFile;
  if (sqliteFile) env.DATA_SQLITE_FILE = sqliteFile;

  const child = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://${host}:${port}`;
  await waitForHealth(baseUrl, { timeoutMs: 8000, child });

  return {
    baseUrl,
    process: child,
    logs,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), delay(2000)]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    },
  };
}

async function waitForHealth(baseUrl, { timeoutMs = 5000, child } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child?.exitCode !== null) {
      throw new Error('Server exited before becoming healthy');
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_error) {
      // retry
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for server at ${baseUrl}`);
}
