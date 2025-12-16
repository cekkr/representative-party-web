import { randomUUID } from 'node:crypto';

import { persistSignatures, persistPetitions } from '../../infra/persistence/storage.js';
import { createNotification } from '../messaging/notifications.js';

export function countSignatures(petitionId, state) {
  return (state.signatures || []).filter((s) => s.petitionId === petitionId).length;
}

export function hasSigned(petitionId, citizen, state) {
  if (!citizen?.pidHash) return false;
  return (state.signatures || []).some((s) => s.petitionId === petitionId && s.authorHash === citizen.pidHash);
}

export async function signPetition({ petition, citizen, state }) {
  if (!citizen?.pidHash) return;
  const entry = {
    id: randomUUID(),
    petitionId: petition.id,
    authorHash: citizen.pidHash,
    createdAt: new Date().toISOString(),
  };
  state.signatures.unshift(entry);
  await persistSignatures(state);
  const count = countSignatures(petition.id, state);
  if (petition.quorum && count >= petition.quorum && petition.status === 'draft') {
    petition.status = 'open';
    await persistPetitions(state);
    await createNotification(state, {
      type: 'quorum_reached',
      recipientHash: citizen.pidHash,
      petitionId: petition.id,
      message: `Quorum reached for petition "${petition.title}". Status set to open.`,
    });
  }
}
