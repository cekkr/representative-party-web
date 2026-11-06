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
  const postHref = text.match(/href="(\/discussion\?post=[^"]+)"[^>]*>Housing<\/a>/)?.[1];
  assert.ok(postHref, 'Home links to the contribution');
  const post = await fetchText(`${server.baseUrl}${postHref}`);
  assert.match(post.text, /Discussion seeded from the home test/);
});

test('Home previews keep group-lane activity out of the Circle workspace', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const create = await postForm(`${baseUrl}/groups`, { name: 'Public Healthcare Circle' }, irene);
  assert.equal(create.status, 200);
  const groupId = (await create.text()).match(/name="groupId" value="([^"]+)"/)?.[1];
  assert.ok(groupId);
  const policy = await postForm(`${baseUrl}/groups/policy`, {
    groupId, laneDiscussion: 'on', lanePetitions: 'on', lanesVisibility: 'members',
  }, irene);
  assert.equal(policy.status, 200);

  const note = await postForm(`${baseUrl}/discussion`, {
    groupId,
    topic: 'Healthcare / Waiting lists',
    content: 'Branch working note: for priority class B, the Palermo CUP overshoots the PNGLA limit by 41%.',
  }, irene);
  assert.equal(note.status, 200);
  const proposal = await postForm(`${baseUrl}/petitions`, {
    groupId,
    topic: 'Healthcare / Waiting lists',
    title: 'Conditional intramoenia',
    summary: 'Review the public waiting time before accepting private appointments in the same specialty.',
  }, irene);
  assert.equal(proposal.status, 200);

  const memberHeaders = { Cookie: irene.cookie };
  const scoped = await fetchText(`${baseUrl}/discussion?group=${groupId}`, { headers: memberHeaders });
  assert.match(scoped.text, /Branch working note/);
  assert.match(scoped.text, /Public Healthcare Circle · Members only/);
  assert.match(scoped.text, new RegExp(`name="group" value="${groupId}"`));
  const postId = scoped.text.match(/&amp;post=([^"]+)"/)?.[1];
  assert.ok(postId);
  const outsider = await createVerifiedSession(baseUrl, { pidHash: 'valentina-sanna' });
  const postUrl = `${baseUrl}/discussion?group=${groupId}&post=${postId}`;
  for (const partial of [{}, { 'X-Requested-With': 'partial' }]) {
    const options = { headers: { Cookie: outsider.cookie, ...partial }, redirect: 'manual' };
    for (const url of [postUrl, `${baseUrl}/discussion?post=${postId}`]) {
      const refused = await fetchText(url, options);
      assert.equal(refused.response.status, 404);
      assert.doesNotMatch(refused.text, /Branch working note|Public Healthcare Circle/);
    }
    const allowed = await fetchText(postUrl, { headers: { ...memberHeaders, ...partial } });
    assert.equal(allowed.response.status, 200);
    assert.match(allowed.text, /Branch working note/);
  }

  const filtered = await fetchText(`${baseUrl}/discussion?group=${groupId}&topic=energy`, {
    headers: { ...memberHeaders, 'X-Requested-With': 'partial' },
  });
  assert.match(filtered.text, /No posts match this topic/);
  assert.match(filtered.text, new RegExp(`href="/discussion\\?group=${groupId}"[^>]*>Clear topic filter`));
  assert.match(filtered.text, new RegExp(`group=${groupId}&amp;topic=energy&amp;compose=post#discussion-compose`));

  for (const headers of [{}, memberHeaders]) {
    const { text } = await fetchText(`${baseUrl}/`, { headers });
    assert.doesNotMatch(text, /Branch working note|Conditional intramoenia|Healthcare \/ Waiting lists/);
  }

  const promote = { intent: 'promote', discussionId: postId };
  for (const intent of ['promote', 'promote-request', 'promote-decide']) {
    const refused = await postForm(postUrl, { ...promote, intent, decision: 'approve' }, outsider);
    assert.equal(refused.status, 404);
  }
  assert.equal((await postForm(`${baseUrl}/groups/policy`, {
    groupId, lanePetitions: 'on', lanesVisibility: 'members',
  }, irene)).status, 200);
  assert.equal((await postForm(postUrl, promote, irene)).status, 404);
  assert.equal((await postForm(`${baseUrl}/groups/policy`, {
    groupId, laneDiscussion: 'on', lanePetitions: 'on', lanesVisibility: 'members',
  }, irene)).status, 200);

  const move = await postForm(postUrl, promote, { ...irene, partial: true });
  assert.equal(move.status, 200);
  assert.equal(move.url, `${baseUrl}/discussion?post=${postId}`);
  const oldLink = await fetchText(postUrl, { headers: { Cookie: outsider.cookie } });
  assert.equal(oldLink.response.url, move.url);
  assert.match(oldLink.text, /Branch working note/);
});
