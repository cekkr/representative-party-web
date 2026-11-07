import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { runMigrations } from '../src/infra/persistence/migrations.js';

const timeline = (html) => html.match(/<dl class="ballot-timing"[^>]*>([\s\S]*?)<\/dl>/)?.[1] || '';

test('migration 29 gives existing proposals explicit closing fields', () => {
  const { data } = runMigrations({
    data: { petitions: [{ id: 'p1', status: 'closed' }, { id: 'p2', closedAt: '2026-03-01T10:00:00.000Z', closedBy: 'x' }] },
    meta: { schemaVersion: 28, migrations: [] },
  });
  assert.equal(data.petitions[0].closedAt, null);
  assert.equal(data.petitions[0].closedBy, null);
  assert.equal(data.petitions[1].closedAt, '2026-03-01T10:00:00.000Z');
  assert.equal(data.petitions[1].closedBy, 'x');
});

test('Ballot shows the voting timeline and what handing the ballot to a delegate would do', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });
  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-calo' });
  const sofia = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  await postForm(`${baseUrl}/admin`, { intent: 'session', sessionId: sofia.sessionId, sessionRole: 'moderator' });
  for (const [session, handle] of [[giulia, 'giulia.ferrero'], [marco, 'marco.deluca'], [irene, 'irene.calo'], [sofia, 'sofia.bianchi']]) {
    await postForm(`${baseUrl}/profile`, { intent: 'handle', handle }, session);
  }

  const draft = await postForm(`${baseUrl}/petitions`, {
    title: 'Publish CUP waiting times weekly',
    summary: 'Every ASP publishes class B waiting times each week.',
    topic: 'Healthcare / Waiting lists',
  }, { ...giulia, partial: true });
  const proposalUrl = new URL(draft.url);
  const petitionId = proposalUrl.searchParams.get('proposal');
  assert.ok(petitionId);
  const ballotUrl = new URL(proposalUrl);
  ballotUrl.searchParams.set('view', 'ballot');

  // Marco delegates the parent category; the proposal is filed under a subcategory.
  assert.equal((await postForm(`${baseUrl}/delegation`, { topic: 'Healthcare', delegateHash: '@irene.calo' }, marco)).status, 200);

  const open = await postForm(`${baseUrl}/petitions/status`, { petitionId, status: 'vote', confirmFreeze: 'on' }, sofia);
  assert.equal(open.status, 200);

  const marcoBallot = (await fetchText(ballotUrl, { headers: { Cookie: marco.cookie } })).text;
  const openTimeline = timeline(marcoBallot);
  assert.match(openTimeline, /<dt>Voting opened<\/dt><dd><time datetime="[^"]+">/);
  assert.match(openTimeline, /<dt>Vote window<\/dt><dd>7 days, until <time datetime="[^"]+">[^<]+<\/time> · 7 days left\. A moderator closes voting\.<\/dd>/);
  // The timeline leads the Ballot, ahead of the frozen text.
  assert.ok(marcoBallot.indexOf('class="ballot-timing"') < marcoBallot.indexOf('Frozen proposal text'));
  assert.match(openTimeline, /<dt>Delegate window<\/dt><dd>5 days to vote a ballot handed to a delegate<\/dd>/);
  assert.match(marcoBallot, /Handing this ballot to your delegate gives it to [\s\S]*?@irene\.calo[\s\S]*?under your <strong>Healthcare<\/strong> delegation\.\s+They have 5 days to vote\./);

  // Without a covering delegation, the page says the hand-off would abstain.
  const giuliaBallot = (await fetchText(ballotUrl, { headers: { Cookie: giulia.cookie } })).text;
  assert.match(giuliaBallot, /No delegation of yours covers Healthcare \/ Waiting lists\.\s+Handing this ballot to a delegate records an abstention\./);

  // Once a choice exists the preview gives way to the readback.
  await postForm(`${baseUrl}/petitions/vote`, { petitionId, choice: 'yes' }, giulia);
  const voted = (await fetchText(ballotUrl, { headers: { Cookie: giulia.cookie } })).text;
  assert.match(voted, /You voted <strong>yes/);
  assert.doesNotMatch(voted, /ballot-delegation/);

  const close = await postForm(`${baseUrl}/petitions/status`, { petitionId, status: 'closed' }, sofia);
  assert.equal(close.status, 200);
  const closed = (await fetchText(ballotUrl, { headers: { Cookie: marco.cookie, 'X-Requested-With': 'partial' } })).text;
  const closedTimeline = timeline(closed);
  assert.match(closedTimeline, /<dt>Voting closed<\/dt><dd><time datetime="[^"]+">[^<]+<\/time> by [\s\S]*?@sofia\.bianchi/);
  assert.doesNotMatch(closedTimeline, /Vote window/);
  assert.doesNotMatch(closed, /ballot-delegation/);

  // Reopening clears the closing record.
  await postForm(`${baseUrl}/petitions/status`, { petitionId, status: 'vote', confirmFreeze: 'on' }, sofia);
  const reopened = timeline((await fetchText(ballotUrl, { headers: { Cookie: marco.cookie } })).text);
  assert.doesNotMatch(reopened, /Voting closed/);
  assert.match(reopened, /Vote window/);
});
