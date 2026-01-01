import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countSignatures, hasSigned, signPetition } from '../src/modules/petitions/signatures.js';

function buildState(overrides = {}) {
  return {
    issuer: 'local',
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    signatures: [],
    petitions: [],
    notifications: [],
    transactions: [],
    profileAttributes: [],
    profileStructures: [],
    settings: {},
    store: {
      saveSignatures: async () => {},
      savePetitions: async () => {},
      saveNotifications: async () => {},
      saveTransactions: async () => {},
    },
    ...overrides,
  };
}

test('signPetition records signatures and advances to discussion when quorum met', async () => {
  const state = buildState();
  const petition = { id: 'petition-1', title: 'Test Petition', status: 'draft', quorum: 1 };
  state.petitions.push(petition);
  const person = { pidHash: 'person-1', sessionId: 'sess-1', handle: 'person-1' };

  await signPetition({ petition, person, state });

  assert.equal(countSignatures(petition.id, state), 1);
  assert.equal(hasSigned(petition.id, person, state), true);
  assert.equal(petition.status, 'discussion');
  assert.equal(state.notifications.length, 1);
  const types = state.transactions.map((entry) => entry.type);
  assert.ok(types.includes('petition_signed'));
  assert.ok(types.includes('petition_quorum'));
});

test('signPetition advances directly to vote when petitionQuorumAdvance is vote', async () => {
  const state = buildState({ settings: { petitionQuorumAdvance: 'vote' } });
  const petition = { id: 'petition-2', title: 'Fast Track', status: 'draft', quorum: 1 };
  state.petitions.push(petition);
  const person = { pidHash: 'person-2', sessionId: 'sess-2', handle: 'person-2' };

  await signPetition({ petition, person, state });

  assert.equal(petition.status, 'open');
});
