import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { getAvailablePort, startServer } from './helpers/server.js';

async function fetchGzipJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: { 'Accept-Encoding': 'gzip' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] || '');
          const decoded = encoding.includes('gzip') ? gunzipSync(buffer) : buffer;
          const text = decoded.toString('utf-8');
          let payload = null;
          try {
            payload = JSON.parse(text);
          } catch (error) {
            payload = null;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, payload });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('ledger and transactions exports gzip when requested', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const ledger = await fetchGzipJson(`${server.baseUrl}/circle/ledger`);
  assert.equal(ledger.status, 200);
  assert.ok(String(ledger.headers['content-encoding'] || '').includes('gzip'));
  assert.ok(ledger.payload?.envelope);

  const transactions = await fetchGzipJson(`${server.baseUrl}/transactions/ledger`);
  assert.equal(transactions.status, 200);
  assert.ok(String(transactions.headers['content-encoding'] || '').includes('gzip'));
  assert.ok(transactions.payload?.envelope);
});
