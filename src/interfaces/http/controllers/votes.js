import { buildVoteEnvelope } from '../../../modules/votes/voteEnvelope.js';
import { getEffectivePolicy } from '../../../modules/circle/policy.js';
import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { ingestVoteGossip } from '../../../modules/federation/ingest.js';
import { getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export function exportVotes({ res, state }) {
  if (!isModuleEnabled(state, 'votes')) {
    return sendModuleDisabledJson({ res, moduleKey: 'votes' });
  }
  const policy = getEffectivePolicy(state);
  const envelopes = state.votes.map((vote) => vote.envelope || buildVoteEnvelope(vote, { policy, issuer: state.issuer }));
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
  const result = await ingestVoteGossip({ state, envelopes, statusHint: body.status, peerHint: body.peer });
  const statusCode = result.statusCode || 200;
  return sendJson(res, statusCode, {
    added: result.added,
    rejected: result.rejected,
    total: result.total,
    replication: profile,
    errors: result.errors,
    error: result.error,
  });
}
