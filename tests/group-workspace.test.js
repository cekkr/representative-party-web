import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('group workspaces keep lane and management access in the selected group', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const sofia = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'sofia.bianchi' }, sofia);
  const write = (route, fields, actor = irene) => postForm(`${baseUrl}${route}`, fields, actor);
  const read = (url, actor = sofia, partial = false) => fetchText(url, {
    headers: { Cookie: actor.cookie, ...(partial ? { 'X-Requested-With': 'partial' } : {}) },
  });

  const parent = await write('/groups', { name: 'Public Healthcare Circle', topics: 'Healthcare' });
  const parentId = new URL(parent.url).searchParams.get('group');
  assert.ok(parentId);
  const branch = await write('/groups', {
    name: 'Waiting Lists Workshop', parentId, topics: 'Healthcare / Waiting lists',
  });
  const branchId = new URL(branch.url).searchParams.get('group');
  assert.ok(branchId);
  const branchUrl = branch.url;
  const settingsUrl = `${branchUrl}&view=settings`;
  const membersUrl = `${branchUrl}&view=members`;
  const decisionsUrl = `${branchUrl}&view=decisions`;
  const laneLink = new RegExp(`href="/discussion\\?group=${branchId}"`);

  const directory = await read(`${baseUrl}/groups`);
  assert.match(directory.text, new RegExp(`href="/groups\\?group=${branchId}"`));
  assert.match(directory.text, /Branch of Public Healthcare Circle/);
  assert.doesNotMatch(directory.text, /action="\/groups\/policy"/);

  const setLane = async (lanesVisibility) => {
    const response = await write('/groups/policy', {
      groupId: branchId, laneDiscussion: 'on', lanesVisibility,
    });
    assert.equal(response.url, settingsUrl);
  };
  await setLane('public');
  assert.match((await read(branchUrl)).text, laneLink);
  await setLane('members');
  const privateOverview = (await read(branchUrl)).text;
  assert.doesNotMatch(privateOverview, laneLink);
  assert.match(privateOverview, /Join this group to read its internal lanes/);
  assert.match(privateOverview, new RegExp(`href="/groups\\?group=${parentId}"`));

  const joined = await write('/groups', { groupId: branchId, action: 'join', returnView: 'members' }, sofia);
  assert.equal(joined.url, membersUrl);
  assert.match(await joined.text(), /sofia\.bianchi/);
  const assigned = await write('/groups/roles', { groupId: branchId, memberHash: '@sofia.bianchi', role: 'laneModerator' });
  assert.equal(assigned.url, membersUrl);
  assert.match((await read(branchUrl)).text, laneLink);
  assert.match((await read(membersUrl)).text, /Lane moderator/);
  assert.doesNotMatch((await read(membersUrl)).text, /action="\/groups\/roles"/);
  assert.doesNotMatch((await read(decisionsUrl)).text, /value="startElection"/);
  assert.match((await read(decisionsUrl, irene)).text, /value="startElection"/);
  const forgedPolicy = await write('/groups/policy', { groupId: branchId, lanesVisibility: 'public' }, sofia);
  assert.equal(forgedPolicy.status, 401);
  for (const partial of [false, true]) {
    const settings = await read(settingsUrl, sofia, partial);
    assert.equal(settings.response.status, 404);
    assert.doesNotMatch(settings.text, /action="\/groups\/policy"/);
    const members = await read(membersUrl, sofia, partial);
    assert.match(members.text, /aria-current="page">Members/);
  }
  assert.match((await read(parent.url)).text, /Not a member/);
});
