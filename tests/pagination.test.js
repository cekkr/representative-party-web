import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paginate, parsePage, DEFAULT_PAGE_SIZE } from '../src/shared/utils/pagination.js';
import { renderPager } from '../src/interfaces/http/views/shared.js';
import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('parsePage clamps to a 1-based page', () => {
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-2'), 1);
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage(undefined), 1);
});

test('paginate windows items and reports metadata', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  const first = paginate(items, { page: 1, pageSize: 20 });
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0], 0);
  assert.equal(first.pageCount, 3);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.startIndex, 1);
  assert.equal(first.endIndex, 20);

  const last = paginate(items, { page: 3, pageSize: 20 });
  assert.equal(last.items.length, 5);
  assert.equal(last.hasNext, false);
  assert.equal(last.endIndex, 45);

  // Out-of-range page clamps to the last page.
  const clamped = paginate(items, { page: 99, pageSize: 20 });
  assert.equal(clamped.page, 3);
});

test('paginate defaults page size and handles empty input', () => {
  const empty = paginate([], {});
  assert.equal(empty.total, 0);
  assert.equal(empty.pageCount, 1);
  assert.equal(empty.startIndex, 0);
  const sized = paginate(Array.from({ length: DEFAULT_PAGE_SIZE + 1 }, (_, i) => i), {});
  assert.equal(sized.items.length, DEFAULT_PAGE_SIZE);
});

test('renderPager hides for a single page and preserves query across pages', () => {
  assert.equal(renderPager({ pageCount: 1 }), '');
  const html = renderPager(
    { page: 1, pageCount: 3, hasPrev: false, hasNext: true, startIndex: 1, endIndex: 20, total: 45 },
    { baseHref: '/discussion', query: { topic: 'energy' } },
  );
  assert.match(html, /href="\/discussion\?topic=energy&amp;page=2"/);
  assert.match(html, /Page 1 of 3/);
});

test('discussion list paginates across pages', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  // discussion_post is rate-limited per identity (6/min), so spread 23 posts across
  // enough sessions to seed more than one page (page size 20).
  const sessions = [];
  for (let i = 0; i < 5; i += 1) {
    sessions.push(await createVerifiedSession(server.baseUrl, { pidHash: `pager-${i}` }));
  }
  for (let i = 0; i < 23; i += 1) {
    const session = sessions[i % sessions.length];
    await postForm(
      `${server.baseUrl}/discussion`,
      { topic: 'general', stance: 'proposal', content: `Pager post number ${i}` },
      { cookie: session.cookie },
    );
  }

  const countPosts = (html) => (html.match(/<article class="topic-card">/g) || []).length;
  const cookie = sessions[0].cookie;
  const browse = `${server.baseUrl}/discussion?q=Pager&topic=general`;

  const { text: page1 } = await fetchText(browse, { headers: { Cookie: cookie } });
  assert.match(page1, /Page 1 of 2/);
  assert.match(page1, /href="\/discussion\?q=Pager&amp;topic=general&amp;page=2"/);
  assert.equal(countPosts(page1), 20, 'first page is a full window of 20');

  const { text: page2 } = await fetchText(`${browse}&page=2`, { headers: { Cookie: cookie } });
  assert.match(page2, /Page 2 of 2/);
  assert.equal(countPosts(page2), 3, 'remaining posts on page 2');
  assert.notEqual(page1, page2);
  const post = page2.match(/page=2&amp;post=([^"]+)/)?.[1];
  assert.ok(post);
  const { text: focused } = await fetchText(`${browse}&page=2&post=${post}`, { headers: { Cookie: cookie } });
  assert.match(focused, /href="\/discussion\?q=Pager&amp;topic=general&amp;page=2"[^>]*>Back to Discussion/);
});

test('social feed paginates across pages', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  // social_post is rate-limited (12/min), so spread 23 posts across sessions. The feed only
  // shows followed authors, so the viewer follows the other authors first.
  const sessions = [];
  for (let i = 0; i < 3; i += 1) {
    const session = await createVerifiedSession(server.baseUrl, { pidHash: `feed-${i}` });
    await postForm(`${server.baseUrl}/profile`, { intent: 'handle', handle: `feeduser${i}` }, { cookie: session.cookie });
    sessions.push(session);
  }
  const cookie = sessions[0].cookie;
  await postForm(`${server.baseUrl}/social/follow`, { handle: 'feeduser1', type: 'circle' }, { cookie });
  await postForm(`${server.baseUrl}/social/follow`, { handle: 'feeduser2', type: 'circle' }, { cookie });

  for (let i = 0; i < 23; i += 1) {
    const session = sessions[i % sessions.length];
    await postForm(
      `${server.baseUrl}/social/post`,
      { content: `Feed post number ${i}`, visibility: 'public' },
      { cookie: session.cookie },
    );
  }

  const { text: page1 } = await fetchText(`${server.baseUrl}/social/feed`, { headers: { Cookie: cookie } });
  assert.match(page1, /Page 1 of 2/);
  const { text: page2 } = await fetchText(`${server.baseUrl}/social/feed?page=2`, { headers: { Cookie: cookie } });
  assert.match(page2, /Page 2 of 2/);
  assert.notEqual(page1, page2);
});

test('forum threads paginate across pages', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  // forum_thread is rate-limited (3 per 5 min), so spread 21 threads across sessions.
  const sessions = [];
  for (let i = 0; i < 8; i += 1) {
    sessions.push(await createVerifiedSession(server.baseUrl, { pidHash: `forum-${i}` }));
  }
  for (let i = 0; i < 21; i += 1) {
    const session = sessions[i % sessions.length];
    await postForm(
      `${server.baseUrl}/forum`,
      { title: `Forum thread number ${i}`, content: `Body for thread ${i}`, topic: 'general' },
      { cookie: session.cookie },
    );
  }

  const cookie = sessions[0].cookie;
  const { text: page1 } = await fetchText(`${server.baseUrl}/forum?q=body`, { headers: { Cookie: cookie } });
  assert.match(page1, /Page 1 of 2/);
  assert.match(page1, /href="\/forum\?q=body&amp;page=2"/);
  const { text: page2 } = await fetchText(`${server.baseUrl}/forum?q=body&page=2`, { headers: { Cookie: cookie } });
  assert.match(page2, /Page 2 of 2/);
  assert.match(page2, /href="\/forum\?thread=[^"]+&amp;q=body&amp;page=2"/);
  assert.notEqual(page1, page2);
});
