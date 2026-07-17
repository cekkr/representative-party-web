import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchJson, fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

/** Promotes a session to admin through the bootstrap window, then closes it. */
async function claimAdmin(baseUrl, sessionId) {
  const response = await postForm(baseUrl, { intent: 'session', sessionId, sessionRole: 'admin' });
  assert.equal(response.status, 200, 'bootstrap window should allow claiming the first admin');
}

test('admin bootstrap window stays open only until an admin session exists', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());
  const adminUrl = `${server.baseUrl}/admin`;

  // Unowned provider: reachable so the operator can run the wizard, and honest about it.
  const { response: openResponse, text: openText } = await fetchText(adminUrl);
  assert.equal(openResponse.status, 200);
  assert.match(openText, /data-admin-bootstrap/, 'unowned provider must warn that /admin is open');

  // Finishing the wizard must not lock the operator out while no admin exists.
  await postForm(adminUrl, { intent: 'settings', circleName: 'Bootstrap Coop', initialized: 'true' });
  const { response: stillOpen } = await fetchText(adminUrl);
  assert.equal(stillOpen.status, 200, 'initialization alone must not close the window');

  // Claiming the first admin latches the window shut.
  const operator = await createVerifiedSession(server.baseUrl, { pidHash: 'operator-admin' });
  await claimAdmin(adminUrl, operator.sessionId);

  const { response: closed, text: closedText } = await fetchText(adminUrl);
  assert.equal(closed.status, 403, 'anonymous access must be refused once an admin exists');
  assert.match(closedText, /Admin access required/);

  const { response: adminOk, text: adminText } = await fetchText(adminUrl, {
    headers: { Cookie: operator.cookie },
  });
  assert.equal(adminOk.status, 200, 'the admin session must still reach /admin');
  assert.doesNotMatch(adminText, /data-admin-bootstrap/, 'owned provider must not show the bootstrap warning');
});

test('admin endpoints refuse anonymous and non-admin sessions once an admin exists', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());
  const adminUrl = `${server.baseUrl}/admin`;

  const operator = await createVerifiedSession(server.baseUrl, { pidHash: 'owner' });
  await claimAdmin(adminUrl, operator.sessionId);
  const member = await createVerifiedSession(server.baseUrl, { pidHash: 'ordinary-member' });

  for (const [label, options] of [
    ['anonymous', {}],
    ['non-admin session', { headers: { Cookie: member.cookie } }],
  ]) {
    const { response: get } = await fetchText(adminUrl, options);
    assert.equal(get.status, 403, `GET /admin must refuse ${label}`);

    const { response: audit } = await fetchText(`${server.baseUrl}/admin/audit`, options);
    assert.equal(audit.status, 403, `/admin/audit must refuse ${label}`);

    const { response: extensions } = await fetchText(`${server.baseUrl}/extensions`, options);
    assert.equal(extensions.status, 403, `/extensions must refuse ${label}`);
  }
});

test('non-admin cannot escalate roles or rewrite settings through /admin', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());
  const adminUrl = `${server.baseUrl}/admin`;

  const operator = await createVerifiedSession(server.baseUrl, { pidHash: 'owner' });
  await claimAdmin(adminUrl, operator.sessionId);
  const attacker = await createVerifiedSession(server.baseUrl, { pidHash: 'attacker' });

  // Privilege escalation: promote self to admin.
  const escalate = await postForm(adminUrl, {
    intent: 'session',
    sessionId: attacker.sessionId,
    sessionRole: 'admin',
  }, { cookie: attacker.cookie });
  assert.equal(escalate.status, 403);

  // Ban the legitimate owner.
  const ban = await postForm(adminUrl, {
    intent: 'session',
    sessionId: operator.sessionId,
    sessionBanned: 'true',
  });
  assert.equal(ban.status, 403);

  // Rewrite provider settings.
  const settings = await postForm(adminUrl, { intent: 'settings', circleName: 'Taken Over' });
  assert.equal(settings.status, 403);

  // Enable an extension (loads a module).
  const extension = await postForm(`${server.baseUrl}/extensions`, {
    id: 'sample-policy-tighten',
    enable: 'true',
  }, { cookie: attacker.cookie });
  assert.equal(extension.status, 403);

  // None of it took effect.
  const { text } = await fetchText(adminUrl, { headers: { Cookie: operator.cookie } });
  assert.doesNotMatch(text, /Taken Over/, 'settings must be unchanged');
  const { payload } = await fetchJson(`${server.baseUrl}/extensions`, {
    headers: { Cookie: operator.cookie },
  });
  assert.deepEqual(payload.enabled, [], 'no extension should have been enabled');
});

test('banned admin loses provider administration', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());
  const adminUrl = `${server.baseUrl}/admin`;

  const owner = await createVerifiedSession(server.baseUrl, { pidHash: 'owner' });
  await claimAdmin(adminUrl, owner.sessionId);

  const rogue = await createVerifiedSession(server.baseUrl, { pidHash: 'rogue-admin' });
  await postForm(adminUrl, {
    intent: 'session',
    sessionId: rogue.sessionId,
    sessionRole: 'admin',
    sessionBanned: 'true',
  }, { cookie: owner.cookie });

  const { response } = await fetchText(adminUrl, { headers: { Cookie: rogue.cookie } });
  assert.equal(response.status, 403, 'a banned admin must not administer the provider');
});
