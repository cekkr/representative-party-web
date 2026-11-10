import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { runMigrations } from '../src/infra/persistence/migrations.js';
import { DAY_MS, describeProposalWindow, listProposalsPastWindow } from '../src/modules/petitions/windows.js';
import { renderProposalsPastWindow } from '../src/interfaces/http/views/petitionView.js';

const NOW = Date.parse('2026-05-20T12:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * DAY_MS).toISOString();

function windowState(petitions, governance = {}) {
  return { settings: { governance }, petitions, groups: [], sessions: new Map() };
}

test('migration 30 recovers the discussion opening from the audit log, never a guess', () => {
  const { data } = runMigrations({
    data: {
      petitions: [
        { id: 'p1', status: 'discussion' },
        { id: 'p2', status: 'discussion' },
        { id: 'p3', status: 'open' },
        { id: 'p4', status: 'discussion', discussionOpenedAt: '2026-01-01T00:00:00.000Z' },
      ],
      transactions: [
        { type: 'petition_status', petitionId: 'p1', payload: { status: 'discussion' }, createdAt: '2026-03-01T10:00:00.000Z' },
        { type: 'petition_quorum', petitionId: 'p1', payload: { status: 'discussion' }, createdAt: '2026-03-05T10:00:00.000Z' },
        { type: 'petition_status', petitionId: 'p1', payload: { status: 'draft' }, createdAt: '2026-03-04T10:00:00.000Z' },
        { type: 'petition_status', petitionId: 'p3', payload: { status: 'discussion' }, createdAt: '2026-03-01T10:00:00.000Z' },
      ],
    },
    meta: { schemaVersion: 29, migrations: [] },
  });
  const byId = Object.fromEntries(data.petitions.map((entry) => [entry.id, entry]));
  assert.equal(byId.p1.discussionOpenedAt, '2026-03-05T10:00:00.000Z');
  assert.equal(byId.p2.discussionOpenedAt, null);
  // A proposal that moved on to voting does not carry a discussion opening it no longer measures.
  assert.equal(byId.p3.discussionOpenedAt, null);
  assert.equal(byId.p4.discussionOpenedAt, '2026-01-01T00:00:00.000Z');
});

test('a proposal window measures the current stage from when it opened', () => {
  const state = windowState([]);
  const discussing = describeProposalWindow(state, { status: 'discussion', discussionOpenedAt: daysAgo(10) }, NOW);
  assert.equal(discussing.stage, 'discussion');
  assert.equal(discussing.windowDays, 14);
  assert.equal(discussing.daysLeft, 4);
  assert.equal(discussing.elapsed, false);

  const voting = describeProposalWindow(state, { status: 'open', freeze: { frozenAt: daysAgo(9) } }, NOW);
  assert.equal(voting.stage, 'vote');
  assert.equal(voting.elapsed, true);
  assert.equal(voting.daysOver, 2);

  const unrecorded = describeProposalWindow(state, { status: 'discussion' }, NOW);
  assert.equal(unrecorded.known, false);
  assert.equal(unrecorded.elapsed, false);

  assert.equal(describeProposalWindow(state, { status: 'draft' }, NOW), null);
  assert.equal(describeProposalWindow(state, { status: 'closed' }, NOW), null);
  const off = describeProposalWindow(windowState([], { voteWindowDays: 0 }), { status: 'open', freeze: { frozenAt: daysAgo(30) } }, NOW);
  assert.equal(off.known, false);
});

test('the moderator queue lists only elapsed windows, most overdue first', () => {
  const state = windowState([
    { id: 'fresh', title: 'Fresh discussion', status: 'discussion', discussionOpenedAt: daysAgo(2) },
    { id: 'late-vote', title: 'Publish CUP waiting times weekly', status: 'open', freeze: { frozenAt: daysAgo(8) } },
    { id: 'late-talk', title: 'Cap intramoenia volumes', status: 'discussion', discussionOpenedAt: daysAgo(20) },
    { id: 'unknown', title: 'Legacy discussion', status: 'discussion' },
    { id: 'done', title: 'Closed vote', status: 'closed', freeze: { frozenAt: daysAgo(40) } },
  ]);
  const { total, items } = listProposalsPastWindow(state, null, { now: NOW });
  assert.equal(total, 2);
  assert.deepEqual(items.map(({ proposal }) => proposal.id), ['late-talk', 'late-vote']);

  const html = renderProposalsPastWindow(state, null, { now: NOW });
  assert.match(html, /data-composer-section="petitions-due"/);
  assert.match(html, /href="\/petitions\?proposal=late-talk" data-partial>Cap intramoenia volumes<\/a>/);
  assert.match(html, /Discussion window ended <time datetime="[^"]+">[^<]+<\/time> \(6 days ago\) · Whole Circle/);
  assert.match(html, /Next: open voting or return the draft\./);
  assert.match(html, /href="\/petitions\?proposal=late-vote&amp;view=ballot"/);
  assert.match(html, /Next: close voting\./);
  assert.doesNotMatch(html, /Fresh discussion|Legacy discussion|Closed vote/);

  const empty = renderProposalsPastWindow(windowState([]), null, { now: NOW });
  assert.match(empty, /No proposal is past its discussion or vote window\./);
});

test('Overview shows the discussion window and only moderators see the queue', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const sofia = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  await postForm(`${baseUrl}/admin`, { intent: 'session', sessionId: sofia.sessionId, sessionRole: 'moderator' });

  const draft = await postForm(`${baseUrl}/petitions`, {
    title: 'Publish CUP waiting times weekly',
    summary: 'Every ASP publishes class B waiting times each week.',
    topic: 'Healthcare / Waiting lists',
  }, { ...giulia, partial: true });
  const proposalUrl = new URL(draft.url);
  const petitionId = proposalUrl.searchParams.get('proposal');
  assert.ok(petitionId);

  const before = (await fetchText(proposalUrl, { headers: { Cookie: giulia.cookie } })).text;
  assert.doesNotMatch(before, /Discussion timeline/);

  assert.equal((await postForm(`${baseUrl}/petitions/status`, { petitionId, status: 'discussion' }, sofia)).status, 200);
  const overview = (await fetchText(proposalUrl, { headers: { Cookie: giulia.cookie } })).text;
  const timeline = overview.match(/<dl class="ballot-timing stage-timing" aria-label="Discussion timeline">([\s\S]*?)<\/dl>/)?.[1] || '';
  assert.match(timeline, /<dt>Discussion opened<\/dt><dd><time datetime="[^"]+">/);
  assert.match(timeline, /<dt>Discussion window<\/dt><dd>14 days, until <time datetime="[^"]+">[^<]+<\/time> · 14 days left\. A moderator opens voting\.<\/dd>/);

  const moderatorBrowse = (await fetchText(`${baseUrl}/petitions`, { headers: { Cookie: sofia.cookie } })).text;
  assert.match(moderatorBrowse, /id="petitions-due"/);
  assert.match(moderatorBrowse, /No proposal is past its discussion or vote window\./);
  const memberBrowse = (await fetchText(`${baseUrl}/petitions`, { headers: { Cookie: giulia.cookie } })).text;
  assert.doesNotMatch(memberBrowse, /id="petitions-due"/);

  // Returning the proposal to draft clears the opening; voting measures from the freeze instead.
  await postForm(`${baseUrl}/petitions/status`, { petitionId, status: 'draft' }, sofia);
  const back = (await fetchText(proposalUrl, { headers: { Cookie: giulia.cookie } })).text;
  assert.doesNotMatch(back, /Discussion timeline/);
});
