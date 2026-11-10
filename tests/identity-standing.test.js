import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { runMigrations } from '../src/infra/persistence/migrations.js';
import {
  applyIdentityStanding,
  findSessionByHash,
  isIdentityBanned,
  resolveIdentityStanding,
  validateHandleChoice,
} from '../src/modules/identity/sessions.js';

function stateWith(sessions) {
  return { sessions: new Map(sessions.map((session) => [session.id, session])) };
}

test('an identity is represented by its chosen handle and keeps a ban across sessions', () => {
  const state = stateWith([
    { id: 'phone', status: 'verified', pidHash: 'giulia', handle: 'giulia.ferrero', role: 'delegate', verifiedAt: 1000 },
    { id: 'laptop', status: 'verified', pidHash: 'giulia', handle: 'person-giulia', role: 'person', verifiedAt: 2000 },
    { id: 'other', status: 'verified', pidHash: 'marco', handle: 'marco.deluca', role: 'person', verifiedAt: 1500, banned: true },
  ]);
  // The newer session has only a synthesized handle, so the chosen one represents her.
  assert.equal(findSessionByHash(state, 'giulia').handle, 'giulia.ferrero');
  assert.deepEqual(resolveIdentityStanding(state, 'giulia', { excludeSessionId: 'new' }),
    { known: true, handle: 'giulia.ferrero', role: 'person', banned: false });
  assert.equal(resolveIdentityStanding(state, 'nobody').known, false);
  assert.equal(isIdentityBanned(state, 'marco'), true);

  // A sibling session may take the handle the identity already holds; another person may not.
  assert.equal(validateHandleChoice(state, 'giulia.ferrero', { sessionId: 'laptop', pidHash: 'giulia' }).ok, true);
  assert.equal(validateHandleChoice(state, 'giulia.ferrero', { sessionId: 'other', pidHash: 'marco' }).ok, false);

  assert.equal(applyIdentityStanding(state, 'giulia', { banned: 1, role: 'moderator' }), 2);
  assert.equal(isIdentityBanned(state, 'giulia'), true, 'the index refreshes after a write');
  assert.equal(state.sessions.get('phone').role, 'moderator');
  assert.equal(state.sessions.get('laptop').banned, true);
  assert.equal(state.sessions.get('laptop').handle, 'person-giulia', 'fields not named stay as they were');
});

test('migration 31 reconciles bans and handles across one identity, leaving roles', () => {
  const { data } = runMigrations({
    data: {
      sessions: [
        { id: 'a', status: 'verified', pidHash: 'giulia', handle: 'giulia.ferrero', role: 'delegate', verifiedAt: 1000, banned: true },
        { id: 'b', status: 'verified', pidHash: 'giulia', handle: 'person-giulia', role: 'person', verifiedAt: 2000 },
        { id: 'c', status: 'verified', pidHash: 'sofia', handle: 'person-sofia', role: 'person', verifiedAt: 1000 },
      ],
    },
    meta: { schemaVersion: 30 },
  });
  const byId = new Map(data.sessions.map((session) => [session.id, session]));
  assert.equal(byId.get('b').banned, true);
  assert.equal(byId.get('b').handle, 'giulia.ferrero');
  assert.equal(byId.get('b').role, 'person');
  assert.deepEqual(byId.get('c'), data.sessions[2], 'a lone session is untouched');
  const again = runMigrations({ data, meta: { schemaVersion: 30 } }).data;
  assert.deepEqual(again.sessions, data.sessions, 'the migration is idempotent');
});

test('verifying again on another device keeps the handle, role, and ban', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, dataAdapter: 'memory', extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const adminUrl = `${baseUrl}/admin`;

  const elena = await createVerifiedSession(baseUrl, { pidHash: 'elena-rossi' });
  assert.equal((await postForm(adminUrl, { intent: 'session', sessionId: elena.sessionId, sessionRole: 'admin' })).status, 200);

  const phone = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, phone);
  await postForm(adminUrl, { intent: 'session', sessionId: phone.sessionId, sessionRole: 'delegate' }, elena);

  // A second device: the new session carries her handle and role from the first.
  const laptop = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const profile = (await fetchText(`${baseUrl}/profile`, { headers: { Cookie: laptop.cookie } })).text;
  assert.match(profile, /@giulia\.ferrero/);
  assert.doesNotMatch(profile, /person-giulia-f/);
  const people = (await fetchText(`${baseUrl}/delegates?q=giulia`, { headers: { Cookie: elena.cookie } })).text;
  assert.equal((people.match(/>@giulia\.ferrero</g) || []).length, 1, 'one card per person');
  assert.match(people, /delegate/i);

  // Choosing a handle on one device renames the person on every device.
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.f' }, laptop);
  assert.match((await fetchText(`${baseUrl}/profile`, { headers: { Cookie: phone.cookie } })).text, /@giulia\.f\b/);

  // A ban on one session holds on the others and on any later verification.
  const ban = await postForm(adminUrl, { intent: 'session', sessionId: phone.sessionId, sessionRole: 'delegate', sessionBanned: 'true' }, elena);
  assert.match(await ban.text(), /Applied to all 2 sessions of this verified person/);
  const post = (actor) => postForm(`${baseUrl}/discussion`, { topic: 'Healthcare', content: 'Class B waits exceed the maximum.' }, actor);
  assert.ok((await post(laptop)).status >= 400, 'the other device is banned too');
  const tablet = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  assert.ok((await post(tablet)).status >= 400, 're-verifying does not shed the ban');
  const tabletProfile = (await fetchText(`${baseUrl}/profile`, { headers: { Cookie: tablet.cookie } })).text;
  assert.match(tabletProfile, /@giulia\.f\b/);
  assert.match(tabletProfile, /Banned/);
});
