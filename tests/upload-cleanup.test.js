import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PATHS } from '../src/config.js';
import { fetchJson } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('upload cleanup persists last run stats in settings', { timeout: 60000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-upload-clean-'));
  const kvFile = path.join(tempDir, 'state.json');
  const uploadsDir = PATHS.UPLOADS_ROOT;
  const uploadFile = path.join(uploadsDir, `cleanup-${Date.now()}.upload`);

  await mkdir(uploadsDir, { recursive: true });
  await writeFile(uploadFile, 'stale upload');
  const past = Date.now() - 2 * 60 * 60 * 1000;
  await utimes(uploadFile, past / 1000, past / 1000);

  const server = await startServer({
    port: await getAvailablePort(),
    dataAdapter: 'kv',
    dataMode: 'centralized',
    kvFile,
    extraEnv: {
      SOCIAL_MEDIA_UPLOAD_RETENTION_HOURS: '1',
      SOCIAL_MEDIA_UPLOAD_CLEANUP_MINUTES: '0',
    },
  });
  t.after(async () => {
    await server.stop();
    await rm(tempDir, { recursive: true, force: true });
    await rm(uploadFile, { force: true });
  });

  const { payload: health } = await fetchJson(`${server.baseUrl}/health`);
  assert.ok(health.uploads?.cleanup?.lastRunAt, 'expected upload cleanup timestamp');

  const stored = JSON.parse(await readFile(kvFile, 'utf8'));
  const cleanup = stored?.settings?.uploadCleanup;
  assert.ok(cleanup?.lastRunAt, 'expected persisted upload cleanup stats');
  assert.ok(cleanup?.lastResult, 'expected persisted cleanup result');
  assert.ok((cleanup.lastResult.cleaned || 0) >= 1, 'expected at least one cleaned upload');
});
