import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchJson, fetchText, postForm, postJson } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function extractFirstPetitionId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/petitions`);
  const match = text.match(/name="petitionId" value="([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse petitionId from petitions page');
  }
  return match[1];
}

test('gossip push caches endpoint skips after module-disabled responses', { timeout: 60000 }, async (t) => {
  const node = await startServer({
    port: await getAvailablePort(),
    dataAdapter: 'memory',
    dataMode: 'hybrid',
  });
  t.after(async () => {
    await node.stop();
  });

  const session = await createVerifiedSession(node.baseUrl, { pidHash: 'gossip-push-skip-cache' });
  await postForm(
    `${node.baseUrl}/admin`,
    { intent: 'session', sessionId: session.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );

  await postForm(
    `${node.baseUrl}/petitions`,
    { title: 'Push skip cache', summary: 'Create vote + tx payloads', quorum: '0' },
    { cookie: session.cookie, partial: true },
  );
  const petitionId = await extractFirstPetitionId(node.baseUrl);
  await postForm(
    `${node.baseUrl}/petitions/status`,
    { petitionId, status: 'vote', quorum: '0', confirmFreeze: 'yes' },
    { cookie: session.cookie, partial: true },
  );
  await postForm(
    `${node.baseUrl}/petitions/vote`,
    { petitionId, choice: 'yes' },
    { cookie: session.cookie, partial: true },
  );

  const peerPort = await getAvailablePort();
  const peerBase = `http://127.0.0.1:${peerPort}`;
  const hits = { ledger: 0, votes: 0, transactions: 0 };
  const peerServer = createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/circle/gossip') {
      hits.ledger += 1;
      sendJson(res, 403, { error: 'gossip_disabled' });
      return;
    }
    if (url === '/votes/gossip') {
      hits.votes += 1;
      sendJson(res, 404, { error: 'module_disabled' });
      return;
    }
    if (url === '/transactions/gossip') {
      hits.transactions += 1;
      sendJson(res, 404, { error: 'module_disabled' });
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  });

  peerServer.listen(peerPort, '127.0.0.1');
  await once(peerServer, 'listening');
  t.after(async () => {
    await new Promise((resolve) => peerServer.close(resolve));
  });

  await postJson(`${node.baseUrl}/circle/peers`, { peer: peerBase });

  await postForm(`${node.baseUrl}/admin`, { intent: 'gossip-push' }, { partial: true });
  await postForm(`${node.baseUrl}/admin`, { intent: 'gossip-push' }, { partial: true });

  assert.equal(hits.ledger, 1, 'ledger gossip should be skipped from cache after first push');
  assert.equal(hits.votes, 1, 'votes gossip should be skipped from cache after first push');
  assert.equal(hits.transactions, 1, 'transactions gossip should be skipped from cache after first push');

  const { payload: health } = await fetchJson(`${node.baseUrl}/health`);
  const pushSkips = health?.gossip?.pushEndpointSkips;
  assert.equal(pushSkips?.total, 3);
  assert.equal(pushSkips?.peers, 1);

  const { text: adminText } = await fetchText(`${node.baseUrl}/admin`);
  assert.match(adminText, /Outbound endpoint skip cache/i);
});
