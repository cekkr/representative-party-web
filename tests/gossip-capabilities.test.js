import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POLICIES } from '../src/config.js';
import { computeLedgerHash } from '../src/modules/circle/federation.js';
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

test('gossip skips vote payloads when peer capabilities disable votes', { timeout: 60000 }, async (t) => {
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

  const session = await createVerifiedSession(nodeA.baseUrl, { pidHash: 'capabilities-user' });
  await postForm(
    `${nodeA.baseUrl}/admin`,
    { intent: 'session', sessionId: session.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );

  await postForm(
    `${nodeA.baseUrl}/petitions`,
    { title: 'Capabilities vote', summary: 'Should skip votes', quorum: '0' },
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

  const fakeModules = {
    social: true,
    petitions: true,
    votes: false,
    delegation: true,
    groups: true,
    federation: true,
    topicGardener: true,
  };
  const fakeReplication = {
    mode: 'hybrid',
    adapter: 'memory',
    validationLevel: 'strict',
    allowPreviews: false,
  };
  const entries = [];
  const envelope = {
    id: `ledger-capabilities-${Date.now()}`,
    issuer: nodeB.baseUrl,
    issuedAt: new Date().toISOString(),
    status: 'validated',
    policy: { id: POLICIES.id, version: POLICIES.version, enforcement: 'observing' },
    entries,
    ledgerHash: computeLedgerHash(entries),
    peers: [nodeB.baseUrl],
    capabilities: { modules: fakeModules, replication: fakeReplication },
  };

  await postJson(`${nodeA.baseUrl}/circle/gossip`, { envelope, peer: nodeB.baseUrl });

  await postForm(`${nodeA.baseUrl}/admin`, { intent: 'gossip-push' }, { partial: true });

  const { payload: healthB } = await fetchJson(`${nodeB.baseUrl}/health`);
  assert.equal(healthB.votes, 0);

  const { payload: healthA } = await fetchJson(`${nodeA.baseUrl}/health`);
  const votesSummary = healthA?.gossip?.outbound?.summary?.votes;
  assert.equal(votesSummary.sent, 0);
  assert.equal(votesSummary.skipped, true);
});
