import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

async function extractPetitionId(baseUrl) {
  const { text } = await fetchText(`${baseUrl}/petitions`);
  const match = text.match(/id="petition-([^"]+)"/);
  if (!match) {
    throw new Error('Failed to parse petitionId from petitions page');
  }
  return match[1];
}

test('petition comments render evidence links', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'evidence-comment' });
  await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Evidence prompt', summary: 'Testing evidence links', body: '' },
    { cookie: session.cookie },
  );

  const petitionId = await extractPetitionId(server.baseUrl);
  await postForm(
    `${server.baseUrl}/petitions/comment`,
    {
      petitionId,
      content: 'Evidence attached',
      evidenceLinks: 'https://example.org/report\nnot-a-url\nhttps://example.com/data',
    },
    { cookie: session.cookie },
  );

  const { text } = await fetchText(`${server.baseUrl}/petitions?proposal=${petitionId}&view=discussion`, {
    headers: { Cookie: session.cookie },
  });

  assert.match(text, /https:\/\/example\.org\/report/);
  assert.match(text, /https:\/\/example\.com\/data/);
  assert.equal(text.includes('not-a-url'), false);
});
