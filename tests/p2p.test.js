import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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

test('p2p ring gossips ledger and votes without conflicts', { timeout: 90000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-ring-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const servers = await Promise.all([
    startServer({
      port: await getAvailablePort(),
      dataAdapter: 'kv',
      dataMode: 'hybrid',
      kvFile: path.join(tempDir, 'node-a.json'),
      extraEnv: { CIRCLE_ISSUER: 'node-a' },
    }),
    startServer({
      port: await getAvailablePort(),
      dataAdapter: 'kv',
      dataMode: 'hybrid',
      kvFile: path.join(tempDir, 'node-b.json'),
      extraEnv: { CIRCLE_ISSUER: 'node-b' },
    }),
    startServer({
      port: await getAvailablePort(),
      dataAdapter: 'kv',
      dataMode: 'hybrid',
      kvFile: path.join(tempDir, 'node-c.json'),
      extraEnv: { CIRCLE_ISSUER: 'node-c' },
    }),
  ]);

  t.after(async () => {
    await Promise.all(servers.map((server) => server.stop()));
  });

  const [nodeA, nodeB, nodeC] = servers;
  const session = await createVerifiedSession(nodeA.baseUrl, { pidHash: 'ring-hash-a' });

  const { payload: ledgerExport } = await fetchJson(`${nodeA.baseUrl}/circle/ledger`);
  const gossipResB = await postJson(`${nodeB.baseUrl}/circle/gossip`, { envelope: ledgerExport.envelope });
  const gossipPayloadB = await gossipResB.json();
  const gossipResC = await postJson(`${nodeC.baseUrl}/circle/gossip`, { envelope: ledgerExport.envelope });
  const gossipPayloadC = await gossipResC.json();
  assert.equal(gossipPayloadB.added, 1);
  assert.equal(gossipPayloadC.added, 1);

  const { payload: healthB } = await fetchJson(`${nodeB.baseUrl}/health`);
  const { payload: healthC } = await fetchJson(`${nodeC.baseUrl}/health`);
  assert.equal(healthB.ledger, 1);
  assert.equal(healthC.ledger, 1);

  const repeatGossip = await postJson(`${nodeB.baseUrl}/circle/gossip`, { envelope: ledgerExport.envelope });
  const repeatPayload = await repeatGossip.json();
  assert.equal(repeatPayload.added, 0);

  await postForm(
    `${nodeA.baseUrl}/petitions`,
    { title: 'Ring petition', summary: 'P2P petition', quorum: '0' },
    { cookie: session.cookie, partial: true },
  );
  const petitionId = await extractFirstPetitionId(nodeA.baseUrl);
  await postForm(
    `${nodeA.baseUrl}/admin`,
    { intent: 'session', sessionId: session.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );
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

  const { payload: voteExport } = await fetchJson(`${nodeA.baseUrl}/votes/ledger`);
  const voteGossipB = await postJson(`${nodeB.baseUrl}/votes/gossip`, { entries: voteExport.entries });
  const votePayloadB = await voteGossipB.json();
  const voteGossipC = await postJson(`${nodeC.baseUrl}/votes/gossip`, { entries: voteExport.entries });
  const votePayloadC = await voteGossipC.json();
  assert.equal(votePayloadB.added, 1);
  assert.equal(votePayloadC.added, 1);

  const { payload: healthBVotes } = await fetchJson(`${nodeB.baseUrl}/health`);
  const { payload: healthCVotes } = await fetchJson(`${nodeC.baseUrl}/health`);
  assert.equal(healthBVotes.votes, 1);
  assert.equal(healthCVotes.votes, 1);

  const voteRepeat = await postJson(`${nodeB.baseUrl}/votes/gossip`, { entries: voteExport.entries });
  const voteRepeatPayload = await voteRepeat.json();
  assert.equal(voteRepeatPayload.added, 0);

  const { payload: txExport } = await fetchJson(`${nodeA.baseUrl}/transactions/ledger`);
  const txGossipB = await postJson(`${nodeB.baseUrl}/transactions/gossip`, { envelope: txExport.envelope });
  const txPayloadB = await txGossipB.json();
  const txGossipC = await postJson(`${nodeC.baseUrl}/transactions/gossip`, { envelope: txExport.envelope });
  const txPayloadC = await txGossipC.json();
  assert.equal(txPayloadB.added, 1);
  assert.equal(txPayloadC.added, 1);

  const { payload: healthBTx } = await fetchJson(`${nodeB.baseUrl}/health`);
  const { payload: healthCTx } = await fetchJson(`${nodeC.baseUrl}/health`);
  assert.equal(healthBTx.transactions.summaries, 1);
  assert.equal(healthCTx.transactions.summaries, 1);
});
