import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('proposal writes use the stored group lane for authorization and redirects', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const member = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const outsider = await createVerifiedSession(baseUrl, { pidHash: 'tommaso-ricci' });
  const moderator = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  const setModerator = await postForm(`${baseUrl}/admin`, {
    intent: 'session', sessionId: moderator.sessionId, sessionRole: 'moderator',
  });
  assert.equal(setModerator.status, 200);

  const group = await postForm(`${baseUrl}/groups`, { name: 'Public Healthcare Circle' }, member);
  const groupId = (await group.text()).match(/name="groupId" value="([^"]+)"/)?.[1];
  assert.ok(groupId);
  const laneUrl = `${baseUrl}/petitions?group=${groupId}`;
  const setLane = (lanesVisibility, enabled) => postForm(`${baseUrl}/groups/policy`, {
    groupId, ...(enabled ? { lanePetitions: 'on' } : {}), lanesVisibility,
  }, member);
  assert.equal((await setLane('members', true)).status, 200);

  const draft = await postForm(`${baseUrl}/petitions`, {
    groupId, title: 'Conditional intramoenia', summary: 'Review the public waiting time first.',
  }, { ...member, partial: true });
  assert.equal(draft.url, laneUrl);
  const petitionId = (await draft.text()).match(/name="petitionId" value="([^"]+)"/)?.[1];
  assert.ok(petitionId);

  const write = (action, fields, actor, partial = false) => postForm(
    `${baseUrl}/petitions/${action}?group=forged`,
    { petitionId, groupId: 'forged', ...fields },
    { ...actor, partial },
  );
  const actions = [
    ['update', { title: 'Unauthorized edit' }],
    ['sign', {}],
    ['comment', { content: 'Unauthorized reply' }],
    ['vote', { choice: 'no' }],
    ['promote', { intent: 'promote-request' }],
  ];
  for (const [action, fields] of actions) {
    const response = await write(action, fields, outsider);
    assert.equal(response.status, 403, action);
    assert.equal((await response.json()).error, 'group_membership_required', action);
  }
  const outsiderHeaders = { Cookie: outsider.cookie };
  assert.doesNotMatch((await fetchText(laneUrl, { headers: outsiderHeaders })).text, /Conditional intramoenia/);

  assert.equal((await setLane('public', true)).status, 200);
  const publicBrowse = await fetchText(laneUrl, { headers: outsiderHeaders });
  assert.match(publicBrowse.text, /Conditional intramoenia/);
  assert.doesNotMatch(publicBrowse.text, /action="\/petitions\/(?:sign|vote|update|comment)"/);
  const publicWrite = await write('comment', { content: 'Unauthorized reply' }, outsider);
  assert.equal(publicWrite.status, 403);

  const comment = await write('comment', { content: 'Use the published CUP data.' }, member, true);
  assert.equal(comment.url, laneUrl);
  const html = await comment.text();
  assert.match(html, /Use the published CUP data/);
  assert.doesNotMatch(html, /Unauthorized (?:edit|reply)/);
  const open = await write('status', { status: 'open', confirmFreeze: 'on' }, moderator);
  assert.equal(open.url, laneUrl);
  const delegate = await postForm(`${baseUrl}/delegation`, { topic: 'general', delegateHash: outsider.pidHash }, member);
  assert.equal(delegate.status, 200);
  const delegatedVote = await write('vote', { choice: 'auto' }, member);
  assert.equal(delegatedVote.status, 403);
  assert.equal((await delegatedVote.json()).error, 'delegate_outside_group_lane');
  const vote = await write('vote', { choice: 'yes' }, member, true);
  assert.equal(vote.url, laneUrl);

  assert.equal((await setLane('members', false)).status, 200);
  const close = await write('status', { status: 'closed' }, moderator);
  assert.equal(close.status, 403);
  assert.equal((await close.json()).error, 'lane_disabled');
});
