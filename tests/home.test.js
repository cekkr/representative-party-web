import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('home renders an operational workspace for verified sessions', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'home-workspace' });

  await postForm(
    `${server.baseUrl}/social/post`,
    { content: 'Home feed update', visibility: 'public' },
    { cookie: session.cookie },
  );
  await postForm(
    `${server.baseUrl}/discussion`,
    { topic: 'Housing', stance: 'proposal', content: 'Discussion seeded from the home test.' },
    { cookie: session.cookie },
  );
  await postForm(
    `${server.baseUrl}/petitions`,
    {
      title: 'Home Petition',
      summary: 'A petition should surface in the workspace lane.',
      body: 'Detailed text for the home dashboard test.',
    },
    { cookie: session.cookie },
  );

  const { text } = await fetchText(`${server.baseUrl}/`, {
    headers: { Cookie: session.cookie },
  });

  assert.match(text, /Home workspace/i);
  assert.match(text, /Current access/i);
  assert.match(text, /Conversation lane/i);
  assert.match(text, /Decision lane/i);
  assert.match(text, /Audit lane/i);
  assert.match(text, /Home feed update/i);
  assert.match(text, /Discussion seeded from the home test/i);
  assert.match(text, /Home Petition/i);
});
