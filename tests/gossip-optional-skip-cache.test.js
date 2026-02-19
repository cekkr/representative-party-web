import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POLICIES } from '../src/config.js';
import { computeLedgerHash } from '../src/modules/circle/federation.js';
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

test('gossip pull caches optional endpoint skips after module-disabled responses', { timeout: 60000 }, async (t) => {
  const node = await startServer({
    port: await getAvailablePort(),
    dataAdapter: 'memory',
    dataMode: 'hybrid',
  });
  t.after(async () => {
    await node.stop();
  });

  const peerPort = await getAvailablePort();
  const peerBase = `http://127.0.0.1:${peerPort}`;
  const hits = { ledger: 0, votes: 0, transactions: 0 };
  const peerEntries = ['peer-cache-hash'];

  const peerServer = createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/circle/ledger') {
      hits.ledger += 1;
      const envelope = {
        id: `ledger-${Date.now()}-${hits.ledger}`,
        issuer: peerBase,
        issuedAt: new Date().toISOString(),
        status: 'validated',
        policy: {
          id: POLICIES.id,
          version: POLICIES.version,
          enforcement: 'observing',
        },
        entries: peerEntries,
        ledgerHash: computeLedgerHash(peerEntries),
        peers: [peerBase],
      };
      sendJson(res, 200, { envelope });
      return;
    }
    if (url === '/votes/ledger') {
      hits.votes += 1;
      sendJson(res, 404, { error: 'module_disabled' });
      return;
    }
    if (url === '/transactions/ledger') {
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

  await postForm(`${node.baseUrl}/admin`, { intent: 'gossip-pull' }, { partial: true });
  await postForm(`${node.baseUrl}/admin`, { intent: 'gossip-pull' }, { partial: true });

  assert.equal(hits.ledger, 2, 'ledger endpoint should still be fetched each pull');
  assert.equal(hits.votes, 1, 'votes ledger should be skipped from cache after first pull');
  assert.equal(hits.transactions, 1, 'transactions ledger should be skipped from cache after first pull');

  const { payload: health } = await fetchJson(`${node.baseUrl}/health`);
  const optionalSkips = health?.gossip?.optionalEndpointSkips;
  assert.equal(optionalSkips?.total, 2);
  assert.equal(optionalSkips?.peers, 1);

  const { text: adminText } = await fetchText(`${node.baseUrl}/admin`);
  assert.match(adminText, /Optional endpoint skip cache/i);
});
