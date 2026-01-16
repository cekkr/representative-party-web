import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('discussion posts render evidence links', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'evidence-discussion' });
  await postForm(
    `${server.baseUrl}/discussion`,
    {
      topic: 'Evidence',
      stance: 'neutral',
      content: 'Evidence attached',
      evidenceLinks: 'https://example.org/report\nnot-a-url\nhttps://example.com/data',
    },
    { cookie: session.cookie, partial: true },
  );

  const { text } = await fetchText(`${server.baseUrl}/discussion`, {
    headers: { Cookie: session.cookie },
  });

  assert.match(text, /https:\/\/example\.org\/report/);
  assert.match(text, /https:\/\/example\.com\/data/);
  assert.equal(text.includes('not-a-url'), false);
});
