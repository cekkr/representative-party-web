import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { runMigrations } from '../src/infra/persistence/migrations.js';
import { renderPager } from '../src/interfaces/http/views/shared.js';
import { paginate } from '../src/shared/utils/pagination.js';

const section = (html, key) =>
  html.match(new RegExp(`<section\\b[^>]*data-composer-section="${key}"[^>]*>([\\s\\S]*?)</section>`))?.[1] || '';

test('directory pagers read Previous/Next and keep the active search', () => {
  const pageInfo = paginate(Array.from({ length: 30 }, (_, i) => i), { page: 2, pageSize: 24 });
  const html = renderPager(pageInfo, { baseHref: '/delegates', query: { q: 'ferr' }, label: 'people', order: 'directory' });
  assert.match(html, /href="\/delegates\?q=ferr&amp;page=1" rel="prev" data-partial>← Previous/);
  assert.match(html, /<span class="muted tiny" aria-hidden="true">Next →<\/span>/);
  assert.match(html, /Page 2 of 2 · 25-30 of 30 people/);
  // Feeds keep their time-ordered wording.
  assert.match(renderPager(paginate([1, 2, 3], { pageSize: 1 }), { baseHref: '/forum' }), /Older →/);
});

test('migrations 27 and 28 give existing notifications explicit source ids', () => {
  const { data } = runMigrations({
    data: { notifications: [{ id: 'n1', type: 'group_created', petitionId: null }] },
    meta: { schemaVersion: 26, migrations: [] },
  });
  assert.deepEqual(data.notifications[0], {
    id: 'n1', type: 'group_created', petitionId: null, discussionId: null, groupId: null, socialPostId: null,
  });
  // Idempotent: running the step again keeps a stored id.
  const again = runMigrations({
    data: { notifications: [{ id: 'n2', discussionId: 'd1', groupId: 'g1' }] },
    meta: { schemaVersion: 26, migrations: [] },
  });
  assert.equal(again.data.notifications[0].discussionId, 'd1');
  assert.equal(again.data.notifications[0].groupId, 'g1');
});

test('People and Groups directories paginate and search with recoverable empty states', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const sessions = [];
  for (let i = 0; i < 26; i += 1) {
    sessions.push(await createVerifiedSession(baseUrl, { pidHash: `member-${String(i).padStart(2, '0')}` }));
  }
  const viewer = { headers: { Cookie: sessions[0].cookie } };
  const first = (await fetchText(`${baseUrl}/delegates`, viewer)).text;
  const firstList = section(first, 'delegate-directory-list');
  assert.equal((firstList.match(/class="discussion record-card person-card"/g) || []).length, 24);
  assert.match(firstList, /<nav class="pager" aria-label="Pagination">/);
  assert.match(firstList, /href="\/delegates\?page=2" rel="next" data-partial>Next →/);
  const second = (await fetchText(`${baseUrl}/delegates?page=2`, { ...viewer, headers: { ...viewer.headers, 'X-Requested-With': 'partial' } })).text;
  assert.equal((section(second, 'delegate-directory-list').match(/person-card"/g) || []).length, 2);
  assert.match(second, /Page 2 of 2/);
  // A search resets to its own first page and has no pager when it fits.
  const searched = (await fetchText(`${baseUrl}/delegates?q=member-2&page=2`, viewer)).text;
  assert.doesNotMatch(section(searched, 'delegate-directory-list'), /class="pager"/);

  const [irene] = sessions;
  await postForm(`${baseUrl}/groups`, { name: 'Healthcare Circle', topics: 'Healthcare / Waiting lists', description: 'Regional health work.' }, irene);
  await postForm(`${baseUrl}/groups`, { name: 'Energy Circle', topics: 'Energy', description: 'Community energy.' }, irene);
  const browse = (await fetchText(`${baseUrl}/groups`, viewer)).text;
  assert.match(browse, /<form class="collection-search" method="get" action="\/groups" role="search"/);
  assert.match(section(browse, 'groups-list'), /2 groups in this Circle/);
  const byCategory = (await fetchText(`${baseUrl}/groups?q=waiting`, viewer)).text;
  const matches = section(byCategory, 'groups-list');
  assert.match(matches, /Healthcare Circle/);
  assert.doesNotMatch(matches, /Energy Circle/);
  assert.match(matches, /1 group match “waiting”/);
  assert.match(matches, /value="waiting"/);
  const none = section((await fetchText(`${baseUrl}/groups?q=transport`, viewer)).text, 'groups-list');
  assert.match(none, /No group matches “transport”/);
  assert.match(none, /href="\/groups" data-partial>browse every group/);
});

test('inbox rows open discussion and group sources through their read gates', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-calo' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });

  const create = await postForm(`${baseUrl}/groups`, { name: 'Palermo branch' }, irene);
  const groupId = (await create.text()).match(/name="groupId" value="([^"]+)"/)?.[1];
  assert.ok(groupId);
  await postForm(`${baseUrl}/groups/policy`, { groupId, laneDiscussion: 'on', lanesVisibility: 'members' }, irene);

  const ireneInbox = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: irene.cookie } })).text;
  assert.match(ireneInbox, new RegExp(`href="/groups\\?group=${groupId}" data-partial>Open group`));

  await postForm(`${baseUrl}/groups`, { action: 'join', groupId }, marco);
  await postForm(`${baseUrl}/discussion`, {
    groupId, topic: 'Healthcare / Waiting lists', content: 'Palermo CUP overshoots the PNGLA limit for class B.',
  }, marco);
  const lane = (await fetchText(`${baseUrl}/discussion?group=${groupId}`, { headers: { Cookie: marco.cookie } })).text;
  const postId = lane.match(/&amp;post=([^"]+)"/)?.[1];
  assert.ok(postId);
  const postUrl = `${baseUrl}/discussion?group=${groupId}&post=${postId}`;
  assert.equal((await postForm(postUrl, { intent: 'promote-request', discussionId: postId }, marco)).status, 200);

  const contributionHref = `/discussion\\?group=${groupId}&amp;post=${postId}`;
  const requested = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: irene.cookie } })).text;
  assert.match(requested, /Request to move an item up/);
  assert.match(requested, new RegExp(`href="${contributionHref}" data-partial>Open contribution`));

  assert.equal((await postForm(postUrl, { intent: 'promote-decide', discussionId: postId, decision: 'decline' }, irene)).status, 200);
  const declined = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(declined, /Your promotion request was declined/);
  assert.match(declined, new RegExp(`href="${contributionHref}" data-partial>Open contribution`));

  // Leaving the members-only lane withholds the message and the link, not the event.
  await postForm(`${baseUrl}/groups`, { action: 'leave', groupId }, marco);
  const after = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(after, /Your promotion request was declined/);
  assert.match(after, /The contribution is unavailable from this inbox\./);
  assert.doesNotMatch(after, /Open contribution/);
});
