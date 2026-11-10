import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { countGroupActivity, listGroupActivity, readGroupActivityFamily } from '../src/modules/groups/groupActivity.js';

const rows = (html) => [...html.matchAll(/<li class="activity-row[^"]*">([\s\S]*?)<\/li>/g)].map((match) => match[1].replace(/\s+/g, ' '));
const panel = (html) => html.match(/data-composer-section="group-activity"[\s\S]*?<\/section>/)?.[0] || '';
const filterNav = (html) => html.match(/<nav class="filter-links"[\s\S]*?<\/nav>/)?.[0] || '';

test('activity attributes each lane event to the group that held the item at the time', () => {
  const group = { id: 'branch', createdAt: '2026-03-01T09:00:00.000Z', members: ['irene', 'sofia'], roles: [
    { hash: 'irene', role: 'admin', joinedAt: '2026-03-01T09:00:00.400Z' },
    { hash: 'sofia', role: 'member', joinedAt: '2026-03-02T10:00:00.000Z' },
  ] };
  const proposal = {
    id: 'p1', title: 'Conditional intramoenia', authorHash: 'sofia', createdAt: '2026-03-03T10:00:00.000Z',
    discussionOpenedAt: '2026-03-04T10:00:00.000Z',
    freeze: { frozenAt: '2026-03-08T10:00:00.000Z', frozenBy: 'sofia' },
    groupId: 'parent',
    promotions: [{ at: '2026-03-06T10:00:00.000Z', fromGroupId: 'branch', toGroupId: 'parent', toGroupName: 'Public Healthcare Circle', byHash: 'irene' }],
    promotionRequests: [{ at: '2026-03-05T10:00:00.000Z', byHash: 'sofia', status: 'declined', decidedAt: '2026-03-05T12:00:00.000Z', decidedByHash: 'irene', targetLabel: 'Public Healthcare Circle' }],
  };
  const state = {
    groups: [group, { id: 'parent', members: ['irene'], roles: [{ hash: 'irene', role: 'admin' }] }],
    groupPolicies: [], groupElections: [], discussions: [], petitions: [proposal], settings: {},
  };
  const types = (events) => events.map((event) => event.type);
  // The roster is gated, so an outsider sees the creation without its actor and no joins.
  const outsider = listGroupActivity(state, null, group);
  assert.deepEqual(types(outsider), ['group_created']);
  assert.equal(outsider[0].actorHash, null);

  const member = { pidHash: 'sofia', role: 'person' };
  const events = listGroupActivity(state, member, group, { canSeeRoster: true });
  // Voting opened after the move, in the parent, so it is not the branch's event.
  assert.deepEqual(types(events), [
    'moved_up', 'promotion_declined', 'promotion_requested', 'proposal_discussion_opened',
    'proposal_created', 'member_joined', 'group_created',
  ]);
  assert.equal(events.at(-1).actorHash, 'irene', 'the creator is named, not listed as a join');
  // The parent lane is members-only and Sofia is not in it, so its title is withheld.
  assert.equal(events[0].record.readable, false);
  assert.deepEqual(countGroupActivity(events), { '': 7, lanes: 5, decisions: 0, membership: 2 });
  assert.equal(readGroupActivityFamily(new URLSearchParams('kind=Decisions')), 'decisions');
  assert.equal(readGroupActivityFamily(new URLSearchParams('kind=ballots')), '');
});

test('group Activity lists elections, lane work, and moves under the source gates', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const sofia = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  const luca = await createVerifiedSession(baseUrl, { pidHash: 'luca-moretti' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'irene.fabbri' }, irene);
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'sofia.bianchi' }, sofia);
  const write = (route, fields, actor = irene) => postForm(`${baseUrl}${route}`, fields, actor);
  const read = async (url, actor, partial = false) => (await fetchText(url, {
    headers: { ...(actor ? { Cookie: actor.cookie } : {}), ...(partial ? { 'X-Requested-With': 'partial' } : {}) },
  })).text;

  const parent = await write('/groups', { name: 'Public Healthcare Circle', topics: 'Healthcare' });
  const parentId = new URL(parent.url).searchParams.get('group');
  const branch = await write('/groups', { name: 'Waiting Lists Workshop', parentId, topics: 'Healthcare / Waiting lists' });
  const branchId = new URL(branch.url).searchParams.get('group');
  assert.ok(parentId && branchId);
  for (const groupId of [parentId, branchId]) {
    await write('/groups/policy', { groupId, laneDiscussion: 'on', lanePetitions: 'on', lanesVisibility: 'members' });
  }
  await write('/groups', { groupId: branchId, action: 'join' }, sofia);

  await write('/discussion', {
    groupId: branchId,
    topic: 'Healthcare / Waiting lists',
    content: 'Branch working note: for priority class B, the Palermo CUP overshoots the PNGLA limit by 41%.',
  }, sofia);
  const draft = await write('/petitions', {
    groupId: branchId,
    topic: 'Healthcare / Waiting lists',
    title: 'Conditional intramoenia',
    summary: 'Review the public waiting time before accepting private appointments in the same specialty.',
  }, sofia);
  const petitionId = new URL(draft.url).searchParams.get('proposal');
  assert.ok(petitionId);
  await write('/petitions/promote', { intent: 'promote-request', petitionId, note: 'This belongs to the whole healthcare circle.' }, sofia);
  await write('/petitions/promote', { intent: 'promote-decide', petitionId, decision: 'decline', reason: 'Finish the costing first.' });

  await write('/groups', { action: 'startElection', groupId: branchId, topic: 'Healthcare / Waiting lists', candidates: '@sofia.bianchi, @irene.fabbri' });
  const decisions = await read(`${baseUrl}/groups?group=${branchId}&view=decisions`, irene);
  const electionId = decisions.match(/id="election-([^"]+)"/)?.[1];
  assert.ok(electionId);
  await write('/groups', { action: 'voteElection', electionId, candidateHash: '@sofia.bianchi' }, sofia);
  await write('/groups', { action: 'closeElection', electionId });

  // The working note moves up into the parent's members-only lane, which Sofia cannot read.
  const lane = await read(`${baseUrl}/discussion?group=${branchId}`, irene);
  const postId = lane.match(/&amp;post=([^"]+)"/)?.[1];
  assert.ok(postId);
  const moved = await write(`/discussion?group=${branchId}&post=${postId}`, { intent: 'promote', discussionId: postId }, { ...irene, partial: true });
  assert.equal(moved.status, 200);

  const activityUrl = `${baseUrl}/groups?group=${branchId}&view=activity`;
  for (const partial of [false, true]) {
    const html = await read(activityUrl, sofia, partial);
    assert.match(html, /<a href="\/groups\?group=[^"]+&amp;view=activity" data-partial aria-current="page">Activity<\/a>/);
    assert.match(html, /data-composer-section="group-activity"/);
    const list = rows(html);
    assert.match(list[0], /A contribution moved up to Public Healthcare Circle\. <span class="muted">You cannot open it from here/);
    assert.doesNotMatch(html, /Palermo CUP/, 'a moved record the viewer cannot read keeps no title');
    assert.ok(list.some((row) => /The <a href="[^"]+view=decisions#election-[^"]+" data-partial>Healthcare \/ Waiting lists<\/a> election closed: .*sofia\.bianchi.* won with 1 ballot/.test(row)));
    assert.ok(list.some((row) => /irene\.fabbri.* declined the request to move <a href="\/petitions\?group=[^"]+&amp;proposal=[^"]+" data-partial>Conditional intramoenia<\/a> up/.test(row)));
    assert.ok(list.some((row) => /sofia\.bianchi.* asked to move .*Conditional intramoenia.* up to Public Healthcare Circle/.test(row)));
    assert.ok(list.some((row) => /sofia\.bianchi.* joined the group/.test(row)));
    assert.ok(list.some((row) => /irene\.fabbri.* created the group/.test(row)));
    assert.ok(list.some((row) => /activity-row--draft|drafted/.test(row)));
    assert.doesNotMatch(panel(html), /voted|second choice/i, 'ballots stay private');
  }

  // Irene can read the parent lane, so the same move keeps its title and link for her.
  const ireneView = await read(activityUrl, irene);
  assert.match(rows(ireneView)[0], new RegExp(`<a href="/discussion\\?group=${parentId}&amp;post=${postId}" data-partial>Branch working note`));

  // An outsider reads decisions and the creation, but no roster or lane work.
  const outsider = await read(activityUrl, luca);
  const outsiderRows = rows(outsider);
  assert.ok(outsiderRows.some((row) => /The group was created/.test(row)));
  assert.ok(outsiderRows.some((row) => /election closed/.test(row)));
  assert.doesNotMatch(panel(outsider), /joined the group|Conditional intramoenia|contribution/);
  assert.doesNotMatch(filterNav(outsider), /kind=lanes/, 'a family with nothing in it is not offered');

  // Filters are GET links; a selected family with no rows stays visible with a way back.
  const filtered = await read(`${activityUrl}&kind=decisions`, sofia, true);
  assert.match(filterNav(filtered), /kind=decisions"[^>]*aria-current="page"[^>]*>Decisions <span class="filter-links__count">2<\/span>/);
  assert.equal(rows(filtered).length, 2);
  const emptyFilter = await read(`${activityUrl}&kind=lanes`, luca);
  assert.match(filterNav(emptyFilter), /kind=lanes"[^>]*aria-current="page"[^>]*>Lanes <span class="filter-links__count">0<\/span>/);
  assert.match(emptyFilter, /No lanes activity in this group yet\. <a href="\/groups\?group=[^"]+&amp;view=activity" data-partial>Show all activity<\/a>/);

  // Overview previews the three newest rows and links the full history.
  const overview = await read(`${baseUrl}/groups?group=${branchId}`, sofia);
  assert.match(overview, /<h3>Recent activity<\/h3>/);
  assert.equal(rows(overview).length, 3);
  assert.match(overview, /href="\/groups\?group=[^"]+&amp;view=activity" data-partial>View all activity<\/a>/);

  // Leaving from Activity returns to Activity.
  const left = await write('/groups', { groupId: branchId, action: 'leave', returnView: 'activity' }, sofia);
  assert.equal(left.url, activityUrl);
});
