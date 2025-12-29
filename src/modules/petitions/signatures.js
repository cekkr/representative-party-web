import { randomUUID } from 'node:crypto';

import { persistSignatures, persistPetitions } from '../../infra/persistence/storage.js';
import { createNotificationWithOutbound } from '../messaging/notifications.js';
import { filterVisibleEntries, stampLocalEntry } from '../federation/replication.js';

export function countSignatures(petitionId, state) {
  return filterVisibleEntries(state.signatures, state).filter((s) => s.petitionId === petitionId).length;
}

export function hasSigned(petitionId, person, state) {
  if (!person?.pidHash) return false;
  return filterVisibleEntries(state.signatures, state).some((s) => s.petitionId === petitionId && s.authorHash === person.pidHash);
}

export async function signPetition({ petition, person, state }) {
  if (!person?.pidHash) return;
  const entry = {
    id: randomUUID(),
    petitionId: petition.id,
    authorHash: person.pidHash,
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, entry);
  state.signatures.unshift(stamped);
  await persistSignatures(state);
  const count = countSignatures(petition.id, state);
  if (petition.quorum && count >= petition.quorum && petition.status === 'draft') {
    const advanceStage = getQuorumAdvanceStage(state);
    petition.status = advanceStage === 'vote' ? 'open' : 'discussion';
    await persistPetitions(state);
    const nextLabel = advanceStage === 'vote' ? 'vote' : 'discussion';
    await createNotificationWithOutbound(
      state,
      {
        type: 'quorum_reached',
        recipientHash: person.pidHash,
        petitionId: petition.id,
        message: `Quorum reached for proposal "${petition.title}". Status set to ${nextLabel}.`,
      },
      { sessionId: person.sessionId, handle: person.handle },
    );
  }
}

export function getQuorumAdvanceStage(state) {
  const raw = state?.settings?.petitionQuorumAdvance || 'discussion';
  return raw === 'vote' ? 'vote' : 'discussion';
}
