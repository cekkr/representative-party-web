import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateHandleChoice } from '../src/modules/identity/sessions.js';
import { resolveHandleForHash, renderActorLabel } from '../src/interfaces/http/views/actorLabel.js';
import { listPeopleDirectory } from '../src/modules/delegation/delegateProfiles.js';

function stateWith(sessions = [], extra = {}) {
  const map = new Map();
  for (const session of sessions) {
    map.set(session.id, session);
  }
  return {
    sessions: map,
    settings: {},
    delegations: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    ...extra,
  };
}

test('validateHandleChoice enforces charset, length, and reserved patterns', () => {
  const state = stateWith();
  assert.equal(validateHandleChoice(state, '').ok, false);
  assert.equal(validateHandleChoice(state, 'ab').ok, false, 'too short');
  assert.equal(validateHandleChoice(state, 'a'.repeat(31)).ok, false, 'too long');
  assert.equal(validateHandleChoice(state, 'bad handle!').ok, false, 'invalid chars');
  assert.equal(validateHandleChoice(state, 'user-1a2b3c4d').ok, false, 'reserved synthesized pattern');
  const good = validateHandleChoice(state, '@Alice_01');
  assert.equal(good.ok, true);
  assert.equal(good.handle, 'Alice_01', 'strips leading @');
});

test('validateHandleChoice accepts firstname.lastname handles but not stray dots', () => {
  const state = stateWith();
  const dotted = validateHandleChoice(state, '@giulia.ferrero');
  assert.equal(dotted.ok, true, 'a natural person handle with a dot is allowed');
  assert.equal(dotted.handle, 'giulia.ferrero');
  assert.equal(validateHandleChoice(state, '.giulia').ok, false, 'no leading dot');
  assert.equal(validateHandleChoice(state, 'giulia.').ok, false, 'no trailing dot');
  assert.equal(validateHandleChoice(state, 'a..b').ok, false, 'no consecutive dots');
});

test('validateHandleChoice rejects a handle taken by another session', () => {
  const state = stateWith([
    { id: 's1', status: 'verified', pidHash: 'h1', handle: 'alice' },
  ]);
  assert.equal(validateHandleChoice(state, 'alice', { sessionId: 's2' }).ok, false);
  // Same session reusing its own handle is allowed.
  assert.equal(validateHandleChoice(state, 'alice', { sessionId: 's1' }).ok, true);
  // Uniqueness is case-insensitive.
  assert.equal(validateHandleChoice(state, 'ALICE', { sessionId: 's2' }).ok, false);
});

test('resolveHandleForHash prefers chosen handle, else synthesizes a stable fallback', () => {
  const state = stateWith([
    { id: 's1', status: 'verified', pidHash: 'abcdef1234567890', handle: 'alice', role: 'person' },
    { id: 's2', status: 'verified', pidHash: 'fedcba9876543210', role: 'user' },
  ]);
  assert.equal(resolveHandleForHash(state, 'abcdef1234567890'), 'alice');
  assert.equal(resolveHandleForHash(state, 'fedcba9876543210'), 'user-fedcba98');
  assert.equal(resolveHandleForHash(state, 'unknownhash'), 'user-unknownh');
  assert.equal(resolveHandleForHash(state, 'anonymous'), 'anonymous');
  assert.equal(resolveHandleForHash(state, ''), '');
});

test('renderActorLabel shows @handle plus a short hash cue and escapes input', () => {
  const state = stateWith([{ id: 's1', status: 'verified', pidHash: 'abcdef1234567890', handle: 'alice' }]);
  const html = renderActorLabel(state, 'abcdef1234567890');
  assert.match(html, /@alice/);
  assert.match(html, /abcdef12…/);
  assert.match(html, /title="abcdef1234567890"/);
  assert.equal(renderActorLabel(state, 'anonymous'), '<span class="muted">anonymous</span>');
});

test('listPeopleDirectory ranks delegates and supports search', () => {
  const state = stateWith(
    [
      { id: 's1', status: 'verified', pidHash: 'h-alice', handle: 'alice', role: 'person' },
      { id: 's2', status: 'verified', pidHash: 'h-bob', handle: 'bob', role: 'delegate' },
      { id: 's3', status: 'pending', pidHash: 'h-cara', handle: 'cara' },
    ],
    {
      delegations: [
        { ownerHash: 'h-alice', delegateHash: 'h-bob', topic: 'general', validationStatus: 'validated' },
      ],
    },
  );
  const all = listPeopleDirectory(state);
  assert.equal(all.length, 2, 'only verified people');
  assert.equal(all[0].hash, 'h-bob', 'delegate with incoming delegations ranks first');
  assert.equal(all[0].incomingUniqueOwners, 1);
  assert.equal(all[0].isDelegate, true);

  const filtered = listPeopleDirectory(state, { query: 'alice' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].handle, 'alice');
});
