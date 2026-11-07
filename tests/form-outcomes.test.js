import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import {
  FLASH_COOKIE,
  FORM_OUTCOME,
  renderOutcomeNotice,
  setFlashNotice,
  takeFlashNotice,
} from '../src/interfaces/http/views/formOutcome.js';
import { ADMIN_OUTCOME } from '../src/modules/admin/adminSections.js';

function fakeResponse() {
  const headers = new Map();
  return {
    headers,
    getHeader: (name) => headers.get(name.toLowerCase()),
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
  };
}

test('flash notices carry a catalog code, never text, and stay with their scope', () => {
  assert.equal(ADMIN_OUTCOME, FORM_OUTCOME, 'admin and member forms share one outcome vocabulary');
  const catalog = { saved: { outcome: FORM_OUTCOME.APPLIED, message: 'Saved.' } };

  const res = fakeResponse();
  setFlashNotice(res, 'groups', 'saved');
  assert.match(res.headers.get('set-cookie')[0], new RegExp(`^${FLASH_COOKIE}=groups\\.saved;.*HttpOnly`));
  setFlashNotice(res, 'groups', '<script>');
  assert.equal(res.headers.get('set-cookie').length, 1, 'an unsafe code is never written');

  const read = (cookie, scope = 'groups') => {
    const reply = fakeResponse();
    const notice = takeFlashNotice({ headers: { cookie: `${FLASH_COOKIE}=${cookie}` } }, reply, scope, catalog);
    return { notice, cleared: Boolean(reply.headers.get('set-cookie')) };
  };
  assert.deepEqual(read('groups.saved'), {
    notice: { code: 'saved', outcome: FORM_OUTCOME.APPLIED, message: 'Saved.' }, cleared: true,
  });
  assert.deepEqual(read('groups.saved', 'delegation'), { notice: null, cleared: false }, 'another page keeps it');
  assert.deepEqual(read('groups.forged'), { notice: null, cleared: true }, 'an unknown code renders nothing');
  assert.deepEqual(read('groups.constructor'), { notice: null, cleared: true }, 'prototype keys are not codes');

  assert.match(renderOutcomeNotice('Saved.', FORM_OUTCOME.APPLIED), /class="form-notice" role="status"/);
  assert.match(renderOutcomeNotice('Refused.', FORM_OUTCOME.NOT_APPLIED), /form-notice is-warning/);
  assert.match(renderOutcomeNotice('Saved.', undefined), /is-warning/, 'a missing outcome is never a confirmation');
});

// A navigating browser: an ordinary form POST that asks for HTML, with no redirect following,
// so the test can carry the one-shot cookie to the GET the way a browser would.
async function browserPost(url, fields, actor) {
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      ...(actor ? { Cookie: actor.cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });
  const flash = (response.headers.getSetCookie?.() || [])
    .find((cookie) => cookie.startsWith(`${FLASH_COOKIE}=`))?.split(';')[0] || '';
  return { response, location: response.headers.get('location') || '', flash };
}

async function follow(baseUrl, { location, flash }, actor) {
  const cookie = [actor?.cookie, flash].filter(Boolean).join('; ');
  return fetchText(new URL(location, baseUrl).href, { headers: cookie ? { Cookie: cookie } : {} });
}

const SUCCESS = /<p class="form-notice" role="status">([^<]+)<\/p>/;
const WARNING = /<p class="form-notice is-warning" role="status">([^<]+)<\/p>/;

test('group, delegation, governance, and extension forms report their outcome beside the work', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, dataAdapter: 'memory' });
  t.after(stop);

  const irene = await createVerifiedSession(baseUrl, { pidHash: 'irene-fabbri' });
  const sofia = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'sofia.bianchi' }, sofia);

  // Groups: the canonical redirect address is unchanged; the notice rides the cookie.
  const created = await browserPost(`${baseUrl}/groups`, { name: 'Waiting Lists Workshop', topics: 'Healthcare / Waiting lists' }, irene);
  assert.equal(created.response.status, 303);
  assert.match(created.location, /^\/groups\?group=[^&#]+$/);
  assert.ok(created.flash, 'a successful write sets a one-shot notice');
  const workspace = await follow(baseUrl, created, irene);
  assert.match(workspace.text, SUCCESS);
  assert.match(workspace.text.match(SUCCESS)[1], /Group created/);
  const groupId = new URL(created.location, baseUrl).searchParams.get('group');

  // A refusal returns to a page the member can read, as a warning, instead of raw JSON.
  const refused = await browserPost(`${baseUrl}/groups/policy`, { groupId, laneDiscussion: 'on' }, sofia);
  assert.equal(refused.response.status, 303);
  assert.equal(refused.location, `/groups?group=${groupId}`, 'never Settings, which 404s for a non-manager');
  const refusedPage = await follow(baseUrl, refused, sofia);
  assert.equal(refusedPage.response.status, 200);
  assert.match(refusedPage.text.match(WARNING)?.[1] || '', /Only a group admin/);
  // Script clients keep the structured refusal.
  const scripted = await postForm(`${baseUrl}/groups/policy`, { groupId, laneDiscussion: 'on' }, sofia);
  assert.equal(scripted.status, 401);
  assert.equal((await scripted.json()).error, 'group_admin_required');

  const missing = await browserPost(`${baseUrl}/groups`, { action: 'join', groupId: 'no-such-group' }, sofia);
  assert.equal(missing.location, '/groups');
  assert.match((await follow(baseUrl, missing, sofia)).text.match(WARNING)?.[1] || '', /no longer exists/);

  // A notice is shown once: the page that renders it clears it.
  const joined = await browserPost(`${baseUrl}/groups`, { groupId, action: 'join', returnView: 'members' }, sofia);
  assert.equal(joined.location, `/groups?group=${groupId}&view=members`);
  assert.match((await follow(baseUrl, joined, sofia)).text.match(SUCCESS)?.[1] || '', /You joined/);
  const reload = await fetchText(new URL(joined.location, baseUrl).href, { headers: { Cookie: sofia.cookie } });
  assert.doesNotMatch(reload.text, /form-notice/);

  // Delegation: an unknown delegate keeps what was typed and says nothing changed.
  const unknown = await browserPost(`${baseUrl}/delegation`, { topic: 'Healthcare', delegateHash: '@nobody.here' }, irene);
  assert.equal(unknown.location, '/delegation?delegate=nobody.here#delegation-set');
  const unknownPage = await follow(baseUrl, unknown, irene);
  assert.match(unknownPage.text.match(WARNING)?.[1] || '', /No verified person matches/);
  assert.match(unknownPage.text, /name="delegateHash"[^>]*value="nobody\.here"/);
  const saved = await browserPost(`${baseUrl}/delegation`, { topic: 'Healthcare', delegateHash: '@sofia.bianchi' }, irene);
  assert.match((await follow(baseUrl, saved, irene)).text.match(SUCCESS)?.[1] || '', /Delegate saved/);
  const clearNone = await browserPost(`${baseUrl}/delegation`, { intent: 'clear', topic: 'Labour' }, irene);
  assert.match((await follow(baseUrl, clearNone, irene)).text.match(WARNING)?.[1] || '', /no delegation on that topic/);

  // Governance: a rejected proposal re-renders with an alert and the typed text kept.
  const invalid = await browserPost(`${baseUrl}/governance/proposals`, {
    governanceProposalTitle: 'Pilot quorum update', governanceProposalReason: '',
  }, irene);
  assert.equal(invalid.response.status, 400);
  const invalidText = await invalid.response.text();
  assert.match(invalidText, /role="alert"[^>]*id="governance-proposal-errors"/);
  assert.match(invalidText, /Proposal reason is required/);
  assert.match(invalidText, /value="Pilot quorum update"/);
  assert.match(invalidText.match(WARNING)?.[1] || '', /not submitted/);
  const proposed = await browserPost(`${baseUrl}/governance/proposals`, {
    governanceProposalTitle: 'Pilot quorum update',
    governanceProposalReason: 'Local pilots need a lower initial quorum.',
    governanceProposalQuorumDefault: '9',
  }, irene);
  assert.equal(proposed.response.status, 303);
  assert.equal(proposed.location, '/governance#governance-propose');
  assert.match((await follow(baseUrl, proposed, irene)).text.match(SUCCESS)?.[1] || '', /Change proposal submitted/);

  // Extensions: the ordinary admin form returns to its own section, not to JSON.
  const operator = await createVerifiedSession(baseUrl, { pidHash: 'operator-admin' });
  await postForm(`${baseUrl}/admin`, { intent: 'session', sessionId: operator.sessionId, sessionRole: 'admin' });
  const extensionsSection = (text) => text.slice(text.indexOf('id="extensions"'), text.indexOf('id="session-overrides"'));
  const notInstalled = await browserPost(`${baseUrl}/extensions`, {
    extensionsForm: '1', extensions: 'sample-policy-tighten',
  }, operator);
  assert.equal(notInstalled.response.status, 303);
  assert.equal(notInstalled.location, '/admin#extensions');
  const notInstalledPage = await follow(baseUrl, notInstalled, operator);
  assert.match(extensionsSection(notInstalledPage.text).match(WARNING)?.[1] || '', /Install an extension before enabling it/);
  const emptied = await browserPost(`${baseUrl}/extensions`, { extensionsForm: '1' }, operator);
  const emptiedSection = extensionsSection((await follow(baseUrl, emptied, operator)).text);
  assert.match(emptiedSection.match(SUCCESS)?.[1] || '', /Enabled extensions saved/, 'an all-unticked form saves an empty list');
});
