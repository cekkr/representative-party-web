import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

const section = (html, key) =>
  html.match(new RegExp(`<section\\b[^>]*data-composer-section="${key}"[^>]*>([\\s\\S]*?)</section>`))?.[1] || '';

test('People profiles are record workspaces that keep members-only lane proposals private', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, giulia);
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'marco.deluca' }, marco);

  // One Circle proposal and one inside a members-only group lane.
  await postForm(`${baseUrl}/petitions`, { title: 'Waiting-list monitoring', summary: 'Publish regional waiting times.' }, giulia);
  const group = await postForm(`${baseUrl}/groups`, { name: 'Healthcare Circle' }, giulia);
  const groupId = (await group.text()).match(/name="groupId" value="([^"]+)"/)?.[1];
  assert.ok(groupId);
  await postForm(`${baseUrl}/groups/policy`, { groupId, lanePetitions: 'on', lanesVisibility: 'members' }, giulia);
  await postForm(`${baseUrl}/petitions`, { groupId, title: 'Internal intramoenia draft', summary: 'Members only.' }, giulia);

  // Directory: one title link per card, search distinguishes zero matches from an empty Circle.
  const directory = (await fetchText(`${baseUrl}/delegates`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(directory, /<h1[^>]*>People<\/h1>/);
  const list = section(directory, 'delegate-directory-list');
  assert.match(list, /class="discussion record-card person-card"/);
  assert.match(list, /<h3><a href="\/delegates\/giulia-ferrero" data-partial>@giulia\.ferrero<\/a><\/h3>/);
  const none = (await fetchText(`${baseUrl}/delegates?q=nobody`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(section(none, 'delegate-directory-list'), /No one matches “nobody”/);
  assert.match(none, /href="\/delegates" data-partial>Clear search/);

  // Profile header: identity, one primary action, and labelled GET sections.
  const profileUrl = `${baseUrl}/delegates/giulia-ferrero`;
  const overview = (await fetchText(profileUrl, { headers: { Cookie: marco.cookie } })).text;
  assert.match(overview, /<nav class="workspace-sections" aria-label="Profile sections">/);
  assert.match(overview, /href="\/delegates\/giulia-ferrero" data-partial aria-current="page">Overview/);
  assert.match(overview, /href="\/delegation\?delegate=giulia\.ferrero#delegation-set"[^>]*>Delegate to @giulia\.ferrero/);
  assert.match(section(overview, 'delegate-profile-summary'), /<dt>Proposals drafted<\/dt><dd>1<\/dd>/);
  const own = (await fetchText(profileUrl, { headers: { Cookie: giulia.cookie } })).text;
  assert.doesNotMatch(own, /Delegate to @giulia/);
  assert.match(own, /Edit your profile/);
  assert.match(section(own, 'delegate-profile-summary'), /<dt>Proposals drafted<\/dt><dd>2<\/dd>/);

  // Activity lists only what the viewer may open, linked to the proposal record.
  const activity = (await fetchText(`${profileUrl}?view=activity`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(activity, /aria-current="page">Activity/);
  assert.match(activity, /Waiting-list monitoring/);
  assert.doesNotMatch(activity, /Internal intramoenia draft/);
  assert.match(activity, /href="\/petitions\?proposal=[^"]+" data-partial>Waiting-list monitoring/);
  const ownActivity = (await fetchText(`${profileUrl}?view=activity`, { headers: { Cookie: giulia.cookie } })).text;
  assert.match(ownActivity, /Internal intramoenia draft/);

  // An unknown view falls back to Overview; the Delegate link pre-fills the form only.
  const fallback = (await fetchText(`${profileUrl}?view=bogus`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(fallback, /aria-current="page">Overview/);
  const prefill = (await fetchText(`${baseUrl}/delegation?delegate=%40giulia.ferrero`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(prefill, /id="delegation-set"/);
  assert.match(prefill, /name="delegateHash"[^>]*value="giulia\.ferrero"/);
});

test('Governance shows the current rule beside each proposed change', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, dataAdapter: 'memory' });
  t.after(stop);
  const tommaso = await createVerifiedSession(baseUrl, { pidHash: 'tommaso-ricci' });
  const guest = (await fetchText(`${baseUrl}/governance`)).text;
  assert.match(guest, /<h1[^>]*>Governance<\/h1>/);
  assert.match(guest, /Verify to propose a change/);
  assert.match(guest, /No change proposals are open/);

  await postForm(`${baseUrl}/governance/proposals`, {
    governanceProposalTitle: 'Reduced quorum for proposals with regional impact',
    governanceProposalReason: 'A uniform quorum starves the long tail.',
    governanceProposalQuorumDefault: '7',
  }, tommaso);
  const html = (await fetchText(`${baseUrl}/governance`, { headers: { Cookie: tommaso.cookie } })).text;
  assert.match(html, /href="#governance-propose">Propose a change/);
  const proposals = section(html, 'governance-proposals');
  assert.match(proposals, /Reduced quorum for proposals with regional impact/);
  assert.match(proposals, /<th scope="col">Current rule<\/th><th scope="col">Proposed<\/th>/);
  assert.match(proposals, /<th scope="row">Default quorum<\/th>\s*<td>\d+ signatures<\/td>\s*<td>7 signatures<\/td>/);
  assert.match(proposals, /Proposed by/);
});
