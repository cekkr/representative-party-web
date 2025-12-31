import { buildVoteEnvelope, verifyVoteEnvelope } from '../../../modules/votes/voteEnvelope.js';
import { persistVotes } from '../../../infra/persistence/storage.js';
import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { decideStatus, getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export function exportVotes({ res, state }) {
  if (!isModuleEnabled(state, 'votes')) {
    return sendModuleDisabledJson({ res, moduleKey: 'votes' });
  }
  const envelopes = state.votes.map((vote) => vote.envelope || buildVoteEnvelope(vote));
  return sendJson(res, 200, { entries: envelopes, replication: getReplicationProfile(state) });
}

export async function gossipVotes({ req, res, state }) {
  if (!isModuleEnabled(state, 'votes')) {
    return sendModuleDisabledJson({ res, moduleKey: 'votes' });
  }
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const profile = getReplicationProfile(state);
  if (!isGossipEnabled(profile)) {
    return sendJson(res, 403, {
      error: 'gossip_disabled',
      message: 'Gossip ingestion is disabled in centralized data mode.',
      replication: profile,
    });
  }
  const body = await readRequestBody(req);
  const envelopes = Array.isArray(body.entries) ? body.entries : [];
  let added = 0;

  for (const envelope of envelopes) {
    const verification = verifyVoteEnvelope(envelope);
    if (verification && !verification.valid && !verification.skipped) {
      continue;
    }
    const replicationStatus = decideStatus(profile, envelope?.status || body.status || 'validated');
    if (replicationStatus.status === 'rejected') {
      continue;
    }
    const voteKey = `${envelope.petitionId}:${envelope.authorHash}`;
    const exists = state.votes.some((vote) => `${vote.petitionId}:${vote.authorHash}` === voteKey);
    if (exists) continue;
    state.votes.push({
      petitionId: envelope.petitionId,
      authorHash: envelope.authorHash,
      choice: envelope.choice,
      createdAt: envelope.createdAt,
      validationStatus: replicationStatus.status,
      envelope: { ...envelope, status: replicationStatus.status },
    });
    added += 1;
  }

  if (added > 0) {
    await persistVotes(state);
  }
  return sendJson(res, 200, { added, total: state.votes.length, replication: profile });
}
