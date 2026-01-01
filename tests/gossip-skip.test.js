import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchJson, fetchText, postForm, postJson } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

async function extractFirstPetitionId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/petitions`);
  const match = text.match(/name="petitionId" value="([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse petitionId from petitions page');
  }
  return match[1];
}

test('gossip skips peers that disable votes without penalizing health', { timeout: 60000 }, async (t) => {
  const nodeA = await startServer({
    port: await getAvailablePort(),
    dataAdapter: 'memory',
    dataMode: 'hybrid',
  });
  const nodeB = await startServer({
    port: await getAvailablePort(),
    dataAdapter: 'memory',
    dataMode: 'hybrid',
  });

  t.after(async () => {
    await nodeA.stop();
    await nodeB.stop();
  });

  await postForm(
    `${nodeB.baseUrl}/admin`,
    { intent: 'modules', module_federation: 'on' },
    { partial: true },
  );

  await postJson(`${nodeA.baseUrl}/circle/peers`, { peer: nodeB.baseUrl });

  const session = await createVerifiedSession(nodeA.baseUrl, { pidHash: 'gossip-skip' });
  await postForm(
    `${nodeA.baseUrl}/admin`,
    { intent: 'session', sessionId: session.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );

  await postForm(
    `${nodeA.baseUrl}/petitions`,
    { title: 'Gossip skip', summary: 'Vote payload check', quorum: '0' },
    { cookie: session.cookie, partial: true },
  );
  const petitionId = await extractFirstPetitionId(nodeA.baseUrl);

  await postForm(
    `${nodeA.baseUrl}/petitions/status`,
    { petitionId, status: 'vote', quorum: '0', confirmFreeze: 'yes' },
    { cookie: session.cookie, partial: true },
  );
  await postForm(
    `${nodeA.baseUrl}/petitions/vote`,
    { petitionId, choice: 'yes' },
    { cookie: session.cookie, partial: true },
  );

  await postForm(`${nodeA.baseUrl}/admin`, { intent: 'gossip-push' }, { partial: true });

  const { payload: health } = await fetchJson(`${nodeA.baseUrl}/health`);
  const summary = health?.gossip?.outbound?.summary;
  assert.ok(summary, 'expected gossip summary');
  assert.equal(summary.votes.failed, 0);
  assert.equal(summary.votes.skipped, true);

  const peerEntry = health?.gossip?.peerHealth?.entries?.find((entry) => entry.peer === nodeB.baseUrl);
  assert.ok(peerEntry, 'expected peer health entry');
  assert.ok(peerEntry.score > 0);
});
