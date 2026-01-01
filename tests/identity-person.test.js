import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getPerson } from '../src/modules/identity/person.js';
import { getPrivilegesForPerson } from '../src/modules/identity/privileges.js';

test('getPerson returns null for missing or unverified sessions', () => {
  const state = {
    settings: {},
    sessions: new Map([
      ['s1', { id: 's1', status: 'pending', pidHash: 'hash-1' }],
    ]),
  };
  const missingCookie = { headers: { cookie: '' } };
  assert.equal(getPerson(missingCookie, state), null);

  const req = { headers: { cookie: 'circle_session=s1' } };
  assert.equal(getPerson(req, state), null);
});

test('getPerson applies default roles and handle prefixes', () => {
  const relaxed = {
    settings: { enforceCircle: false },
    sessions: new Map([
      ['s2', { id: 's2', status: 'verified', pidHash: 'hash-2' }],
    ]),
  };
  const relaxedReq = { headers: { cookie: 'circle_session=s2' } };
  const relaxedPerson = getPerson(relaxedReq, relaxed);
  assert.equal(relaxedPerson.role, 'user');
  assert.ok(relaxedPerson.handle.startsWith('user-'));

  const strict = {
    settings: { enforceCircle: true },
    sessions: new Map([
      ['s3', { id: 's3', status: 'verified', pidHash: 'hash-3', role: 'moderator' }],
    ]),
  };
  const strictReq = { headers: { cookie: 'circle_session=s3' } };
  const strictPerson = getPerson(strictReq, strict);
  assert.equal(strictPerson.role, 'moderator');
  assert.ok(strictPerson.handle.startsWith('person-'));
});

test('getPrivilegesForPerson marks guest defaults and banned actors', () => {
  const guest = getPrivilegesForPerson(null);
  assert.equal(guest.role, 'guest');
  assert.equal(guest.canPost, false);

  const banned = getPrivilegesForPerson({ role: 'person', banned: true });
  assert.equal(banned.banned, true);
  assert.equal(banned.canPost, false);
  assert.equal(banned.canDelegate, false);
});
