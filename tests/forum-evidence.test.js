import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

async function extractThreadId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/forum`);
  const match = text.match(/name="parentId" value="([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse thread id from forum page');
  }
  return match[1];
}

test('forum comments render evidence links', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'evidence-forum' });
  await postForm(
    `${server.baseUrl}/forum`,
    { title: 'Evidence thread', content: 'Forum content' },
    { cookie: session.cookie },
  );

  const threadId = await extractThreadId(server.baseUrl);
  await postForm(
    `${server.baseUrl}/forum/comment`,
    {
      parentId: threadId,
      content: 'Evidence attached',
      evidenceLinks: 'https://example.org/report\nnot-a-url\nhttps://example.com/data',
    },
    { cookie: session.cookie },
  );

  const { text } = await fetchText(`${server.baseUrl}/forum`, {
    headers: { Cookie: session.cookie },
  });

  assert.match(text, /https:\/\/example\.org\/report/);
  assert.match(text, /https:\/\/example\.com\/data/);
  assert.equal(text.includes('not-a-url'), false);
});
