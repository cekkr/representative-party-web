import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { proposalHref, readProposalStance } from '../src/modules/petitions/proposalLinks.js';

const filterNav = (html) => html.match(/<nav class="stance-filter"[\s\S]*?<\/nav>/)?.[0] || '';
const noteIds = (html) => [...html.matchAll(/id="proposal-note-([^"]+)"/g)].map((match) => match[1]);

test('stance filter links stay on the Discussion view and ignore unknown stances', () => {
  const proposal = { id: 'p1', groupId: 'g1' };
  assert.equal(proposalHref(proposal, { view: 'discussion', stance: 'concern' }), '/petitions?group=g1&proposal=p1&view=discussion&stance=concern');
  // Other views never carry a reading filter.
  assert.equal(proposalHref(proposal, { view: 'ballot', stance: 'concern' }), '/petitions?group=g1&proposal=p1&view=ballot');
  assert.equal(readProposalStance(new URLSearchParams('stance=Support')), 'support');
  assert.equal(readProposalStance(new URLSearchParams('stance=<script>')), '');
});

test('proposal Discussion filters notes by stance without losing the deliberation', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, giulia);
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'marco.deluca' }, marco);

  const draft = await postForm(`${baseUrl}/petitions`, {
    title: 'Conditional intramoenia',
    summary: 'Suspend intramoenia where public waiting times exceed the regional maximum.',
    topic: 'Healthcare / Waiting lists',
  }, { ...giulia, partial: true });
  const petitionId = new URL(draft.url).searchParams.get('proposal');
  assert.ok(petitionId);

  const comment = (fields, actor) => postForm(`${baseUrl}/petitions/comment`, { petitionId, ...fields }, actor);
  await comment({ stance: 'support', content: 'Waiting times at ASP Bari exceed 120 days for class B.', argumentTitle: 'Class B waits exceed the maximum' }, giulia);
  const allUrl = `${baseUrl}/petitions?proposal=${petitionId}&view=discussion`;
  const read = async (url, partial = false) => (await fetchText(url, {
    headers: { Cookie: marco.cookie, ...(partial ? { 'X-Requested-With': 'partial' } : {}) },
  })).text;
  const [claimId] = noteIds(await read(allUrl));
  await comment({ stance: 'concern', content: 'A blanket suspension pushes specialists to private practice.', argumentTitle: 'Specialist flight', argumentParentId: claimId }, marco);
  await comment({ stance: 'question', content: 'Which threshold applies to oncology?' }, marco);

  const all = await read(allUrl);
  const nav = filterNav(all);
  assert.match(nav, /aria-label="Filter notes by stance"/);
  assert.match(nav, /aria-current="page"[^>]*>All notes <span class="stance-filter__count">3<\/span>/);
  assert.match(nav, /stance=support[^"]*"[^>]*>Support <span class="stance-filter__count">1<\/span>/);
  assert.doesNotMatch(nav, /stance=comment/, 'a stance with no notes is not offered');
  assert.equal(noteIds(all).length, 3);
  assert.match(all, /comment-card--support/);
  assert.match(all, /comment-card--concern/);

  for (const partial of [false, true]) {
    const concerns = await read(`${allUrl}&stance=concern`, partial);
    assert.equal(noteIds(concerns).length, 1);
    assert.match(filterNav(concerns), /stance=concern"[^>]*aria-current="page"/);
    // The rebuttal's claim is filtered out, so its link opens the full deliberation.
    assert.match(concerns, new RegExp(`href="/petitions\\?proposal=${petitionId}&amp;view=discussion#proposal-note-${claimId}" data-partial>Builds on “Class B waits exceed the maximum”`));
    // Counts still describe every note, and the compose form stays.
    assert.match(filterNav(concerns), />All notes <span class="stance-filter__count">3<\/span>/);
    assert.match(concerns, /action="\/petitions\/comment"/);
  }

  // A stance with no notes reads as a filtered empty view with a way back.
  const empty = await read(`${allUrl}&stance=comment`);
  assert.equal(noteIds(empty).length, 0);
  assert.match(empty, /No note on this proposal is marked Note yet\. <a href="\/petitions\?proposal=[^"]+&amp;view=discussion" data-partial>Show all notes<\/a>/);

  // Another view drops the filter, and an unknown stance shows everything.
  assert.equal(noteIds(await read(`${allUrl}&stance=bogus`)).length, 3);
  const overview = await read(`${baseUrl}/petitions?proposal=${petitionId}&stance=concern`);
  assert.doesNotMatch(overview, /stance-filter/);
  assert.match(overview, /stage--draft/);

  // The collection carries the same stage cue as a card band.
  assert.match(await read(`${baseUrl}/petitions`), new RegExp(`record-card record-card--draft" id="petition-${petitionId}"`));
});

test('group Decisions separates open elections, current results, and earlier results', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });
  for (const [session, handle] of [[irene, 'irene.fabbri'], [giulia, 'giulia.ferrero'], [marco, 'marco.deluca']]) {
    await postForm(`${baseUrl}/profile`, { intent: 'handle', handle }, session);
  }
  const created = await postForm(`${baseUrl}/groups`, { name: 'Public Healthcare Circle', topics: 'Healthcare' }, irene);
  const groupId = new URL(created.url).searchParams.get('group');
  const decisionsUrl = `${created.url}&view=decisions`;
  const read = async (actor = irene) => (await fetchText(decisionsUrl, { headers: { Cookie: actor.cookie } })).text;
  const elections = async () => [...(await read()).matchAll(/id="election-([^"]+)"/g)].map((match) => match[1]);

  assert.match(await read(), /No elections yet\./);

  const start = (topic) => postForm(`${baseUrl}/groups`, { action: 'startElection', groupId, topic, candidates: '@giulia.ferrero, @marco.deluca' }, irene);
  const vote = (electionId, candidate) => postForm(`${baseUrl}/groups`, { action: 'voteElection', electionId, candidateHash: candidate }, irene);
  const close = (electionId) => postForm(`${baseUrl}/groups`, { action: 'closeElection', electionId }, irene);

  await start('healthcare');
  const [first] = await elections();
  await vote(first, 'marco-deluca');
  await close(first);
  await start('healthcare');
  const second = (await elections()).find((id) => id !== first);
  await vote(second, 'giulia-ferrero');
  await close(second);
  await start('energy');

  const html = await read();
  const openAt = html.indexOf('<h3>Open elections');
  const currentAt = html.indexOf('<h3>Current results');
  const earlierAt = html.indexOf('<summary>Earlier results (1)</summary>');
  assert.ok(openAt > -1 && currentAt > openAt && earlierAt > currentAt, 'open, current, then earlier');
  assert.match(html, /<h3>Open elections <span class="muted small">\(1\)<\/span><\/h3>/);
  assert.match(html, /<h3>Current results <span class="muted small">\(1\)<\/span><\/h3>/);
  // The newest closed healthcare election is current; the older one folds away.
  assert.ok(html.indexOf(`id="election-${second}"`) < earlierAt);
  assert.ok(html.indexOf(`id="election-${first}"`) > earlierAt);
  assert.match(html.slice(currentAt, earlierAt), /<strong>Winner:<\/strong>[\s\S]*?@giulia\.ferrero[\s\S]*?1 ballot · First-preference majority · Closed <time datetime=/);
  // The voter sees their own ballot recorded, and the open card offers a change.
  assert.match(html, /You voted/);
  const openCard = html.slice(openAt, currentAt);
  assert.match(openCard, /stage--vote">Open/);
  assert.match(openCard, />Vote<\/button>/);
  await vote((await elections()).find((id) => id !== first && id !== second), 'giulia-ferrero');
  const changed = await read();
  const changedOpen = changed.slice(0, changed.indexOf('<h3>Current results'));
  assert.match(changedOpen, />Change vote<\/button>/);
  assert.match(changedOpen, /name="candidateHash"[^>]*>[\s\S]*?<option value="giulia-ferrero" selected>/);
});
