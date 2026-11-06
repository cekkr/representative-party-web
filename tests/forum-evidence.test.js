import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('forum comments render evidence links', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'evidence-forum' });
  const article = await postForm(
    `${server.baseUrl}/forum`,
    { title: 'Waiting-list review', content: 'Palermo CUP evidence', topic: 'Healthcare / Waiting lists' },
    { cookie: session.cookie },
  );
  const threadId = new URL(article.url).searchParams.get('thread');
  assert.ok(threadId);
  assert.match(await article.text(), /Healthcare \/ Waiting lists/);

  const reply = await postForm(
    `${server.baseUrl}/forum/comment?q=waiting&page=2`,
    {
      parentId: threadId,
      content: 'Evidence attached',
      evidenceLinks: 'https://example.org/report\nnot-a-url\nhttps://example.com/data',
    },
    { cookie: session.cookie, partial: true },
  );
  assert.equal(reply.url, `${article.url}&q=waiting&page=2`);
  const text = await reply.text();
  assert.match(text, /href="\/forum\?q=waiting&amp;page=2"/);
  assert.match(text, /<time[^>]+datetime="/);
  assert.match(text, /https:\/\/example\.org\/report/);
  assert.match(text, /https:\/\/example\.com\/data/);
  assert.doesNotMatch(text, /not-a-url/);

  const { text: browse } = await fetchText(`${server.baseUrl}/forum?q=healthcare`, {
    headers: { Cookie: session.cookie },
  });
  assert.ok(browse.includes(`/forum?thread=${threadId}&amp;q=healthcare`));
  assert.match(browse, /1 reply/);
  assert.doesNotMatch(browse, /Evidence attached|action="\/forum\/comment/);
  const { text: empty } = await fetchText(`${server.baseUrl}/forum?q=no-such-article`);
  assert.match(empty, /No articles match your search/);
  assert.match(empty, /Clear search/);
  const { response: missing, text: recovery } = await fetchText(`${server.baseUrl}/forum?thread=missing`);
  assert.equal(missing.status, 404);
  assert.match(recovery, /That article could not be found/);
});
