import { buildVoteEnvelope, verifyVoteEnvelope } from '../../modules/votes/voteEnvelope.js';
import { persistVotes } from '../../infra/persistence/storage.js';
import { sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { decideStatus, getReplicationProfile } from '../../modules/federation/replication.js';

export function exportVotes({ res, state }) {
  const envelopes = state.votes.map((vote) => vote.envelope || buildVoteEnvelope(vote));
  return sendJson(res, 200, { entries: envelopes, replication: getReplicationProfile(state) });
}

export async function gossipVotes({ req, res, state }) {
  const body = await readRequestBody(req);
  const envelopes = Array.isArray(body.entries) ? body.entries : [];
  let added = 0;
  const profile = getReplicationProfile(state);

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
