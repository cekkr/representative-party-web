import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

async function extractFirstPetitionId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/petitions`);
  const match = text.match(/name="petitionId" value="([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse petitionId from petitions page');
  }
  return match[1];
}

test('petition status update requires freeze confirmation before voting', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const author = await createVerifiedSession(server.baseUrl, { pidHash: 'author-freeze' });
  const moderator = await createVerifiedSession(server.baseUrl, { pidHash: 'moderator-freeze' });

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: moderator.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );

  await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Freeze Required', summary: 'Testing freeze gating', body: 'Detailed body' },
    { cookie: author.cookie },
  );

  const petitionId = await extractFirstPetitionId(server.baseUrl);

  const blocked = await postForm(
    `${server.baseUrl}/petitions/status`,
    { petitionId, status: 'vote', quorum: '0' },
    { cookie: moderator.cookie },
  );
  assert.equal(blocked.status, 400);
  const blockedPayload = await blocked.json();
  assert.equal(blockedPayload.error, 'vote_freeze_required');

  const allowed = await postForm(
    `${server.baseUrl}/petitions/status`,
    { petitionId, status: 'vote', quorum: '0', confirmFreeze: 'yes' },
    { cookie: moderator.cookie },
  );
  assert.equal(allowed.ok, true);

  const { text } = await fetchText(`${server.baseUrl}/petitions`);
  assert.ok(text.includes('Frozen proposal text'));
});
