import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('proposal workspaces, writes and alerts use the stored group lane', async (t) => {
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
  const proposalUrl = new URL(draft.url);
  assert.equal(proposalUrl.searchParams.get('group'), groupId);
  const petitionId = proposalUrl.searchParams.get('proposal');
  assert.ok(petitionId);
  assert.match(await draft.text(), /data-composer-section="petition-overview"/);
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
  for (const view of ['overview', 'discussion', 'history', 'ballot']) {
    const privateUrl = new URL(proposalUrl);
    privateUrl.searchParams.set('view', view);
    for (const headers of [outsiderHeaders, { ...outsiderHeaders, 'X-Requested-With': 'partial' }]) {
      const forbidden = await fetchText(privateUrl, { headers });
      assert.equal(forbidden.response.status, 404, view);
      assert.match(forbidden.text, /Proposal unavailable/);
      assert.doesNotMatch(forbidden.text, /Conditional intramoenia|Review the public waiting time/);
    }
  }
  const forgedRead = await fetchText(`${baseUrl}/petitions?group=forged&proposal=${petitionId}`, { headers: outsiderHeaders });
  assert.equal(forgedRead.response.status, 404);
  assert.equal(forgedRead.response.redirected, false);
  assert.equal((await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'tommaso.ricci' }, outsider)).status, 200);
  await write('comment', { content: 'Private mention for @tommaso.ricci.' }, member);
  const outsiderInbox = () => fetchText(`${baseUrl}/notifications`, { headers: outsiderHeaders });
  assert.doesNotMatch((await outsiderInbox()).text, /Mention in a proposal/);

  assert.equal((await setLane('public', true)).status, 200);
  const publicBrowse = await fetchText(laneUrl, { headers: outsiderHeaders });
  assert.match(publicBrowse.text, /Conditional intramoenia/);
  assert.doesNotMatch(publicBrowse.text, /action="\/petitions\/(?:sign|vote|update|comment)"/);
  const publicProposal = await fetchText(proposalUrl, { headers: outsiderHeaders });
  assert.match(publicProposal.text, /Public lane/);
  assert.doesNotMatch(publicProposal.text, /action="\/petitions\/(?:sign|vote|update|comment)"/);
  const publicWrite = await write('comment', { content: 'Unauthorized reply' }, outsider);
  assert.equal(publicWrite.status, 403);

  const comment = await write('comment', {
    content: 'Use the published CUP data, @tommaso.ricci.', browseStage: 'draft', browsePage: '2',
  }, member, true);
  const commentUrl = new URL(comment.url);
  assert.equal(commentUrl.searchParams.get('proposal'), petitionId);
  assert.equal(commentUrl.searchParams.get('group'), groupId);
  assert.equal(commentUrl.searchParams.get('view'), 'discussion');
  assert.equal(commentUrl.searchParams.get('stage'), 'draft');
  assert.equal(commentUrl.searchParams.get('page'), '2');
  const html = await comment.text();
  assert.match(html, /Use the published CUP data/);
  const publicInbox = await outsiderInbox();
  assert.match(publicInbox.text, /Conditional intramoenia/);
  // The row names the proposal and its lane before the reader opens it.
  // The mention already quotes the title, so the line keeps only lane and topic.
  assert.match(publicInbox.text, /<p class="notification-scope muted small">Public Healthcare Circle · Public lane · general<\/p>/);
  assert.match(publicInbox.text, new RegExp(`group=${groupId}&amp;proposal=${petitionId}&amp;view=discussion`));
  assert.doesNotMatch(html, /Unauthorized (?:edit|reply)/);
  const open = await write('status', { status: 'open', confirmFreeze: 'on' }, moderator);
  const ballotUrl = new URL(proposalUrl);
  ballotUrl.searchParams.set('view', 'ballot');
  assert.equal(open.url, ballotUrl.href);
  const delegate = await postForm(`${baseUrl}/delegation`, { topic: 'general', delegateHash: outsider.pidHash }, member);
  assert.equal(delegate.status, 200);
  const delegatedVote = await write('vote', { choice: 'auto' }, member);
  assert.equal(delegatedVote.status, 403);
  assert.equal((await delegatedVote.json()).error, 'delegate_outside_group_lane');
  const vote = await write('vote', { choice: 'yes' }, member, true);
  assert.equal(vote.url, ballotUrl.href);
  assert.match(await vote.text(), /You voted <strong>yes/);
  assert.equal((await setLane('members', true)).status, 200);
  const restrictedInbox = await outsiderInbox();
  assert.match(restrictedInbox.text, /The proposal is unavailable from this inbox/);
  assert.doesNotMatch(restrictedInbox.text, /Conditional intramoenia|Open proposal|Public Healthcare Circle|notification-scope/);

  assert.equal((await setLane('members', false)).status, 200);
  const close = await write('status', { status: 'closed' }, moderator);
  assert.equal(close.status, 403);
  assert.equal((await close.json()).error, 'lane_disabled');

  assert.equal((await setLane('members', true)).status, 200);
  const promoted = await write('promote', {}, member);
  assert.equal(new URL(promoted.url).searchParams.get('proposal'), petitionId);
  assert.equal(new URL(promoted.url).searchParams.get('group'), null);
  const moved = await fetchText(commentUrl, { headers: { Cookie: member.cookie, 'X-Requested-With': 'partial' } });
  assert.equal(moved.response.redirected, true);
  assert.equal(new URL(moved.response.url).searchParams.get('group'), null);
  assert.match(moved.text, /Use the published CUP data/);
});
