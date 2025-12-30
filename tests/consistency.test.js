import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchJson, fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

async function extractFirstPetitionId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/petitions`);
  const match = text.match(/name="petitionId" value="([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse petitionId from petitions page');
  }
  return match[1];
}

test('standalone server keeps data consistent across restart', { timeout: 60000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-standalone-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const kvFile = path.join(tempDir, 'state.json');

  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'kv', dataMode: 'centralized', kvFile });
  const baseUrl = server.baseUrl;

  try {
    const session = await createVerifiedSession(baseUrl, { pidHash: 'standalone-hash' });
    await postForm(
      `${baseUrl}/discussion`,
      { topic: 'Energy', stance: 'neutral', content: 'Standalone post' },
      { cookie: session.cookie, partial: true },
    );
    await postForm(
      `${baseUrl}/petitions`,
      { title: 'Standalone petition', summary: 'Petition summary', quorum: '0' },
      { cookie: session.cookie, partial: true },
    );

    const petitionId = await extractFirstPetitionId(baseUrl);
    await postForm(
      `${baseUrl}/admin`,
      { intent: 'session', sessionId: session.sessionId, sessionRole: 'moderator' },
      { partial: true },
    );
    await postForm(
      `${baseUrl}/petitions/status`,
      { petitionId, status: 'vote', quorum: '0' },
      { cookie: session.cookie, partial: true },
    );
    await postForm(
      `${baseUrl}/petitions/vote`,
      { petitionId, choice: 'yes' },
      { cookie: session.cookie, partial: true },
    );

    const { payload: health } = await fetchJson(`${baseUrl}/health`);
    assert.equal(health.discussions, 1);
    assert.equal(health.petitions, 1);
    assert.equal(health.votes, 1);
    assert.ok(health.transactions.count >= 3);
  } finally {
    await server.stop();
  }

  const restartPort = await getAvailablePort();
  const serverRestarted = await startServer({ port: restartPort, dataAdapter: 'kv', dataMode: 'centralized', kvFile });
  t.after(async () => serverRestarted.stop());

  const { payload: healthAfter } = await fetchJson(`${serverRestarted.baseUrl}/health`);
  assert.equal(healthAfter.discussions, 1);
  assert.equal(healthAfter.petitions, 1);
  assert.equal(healthAfter.votes, 1);
});
