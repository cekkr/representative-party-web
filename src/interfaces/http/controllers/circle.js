import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { buildLedgerEnvelope } from '../../../modules/circle/federation.js';
import { ingestLedgerGossip } from '../../../modules/federation/ingest.js';
import { getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export async function handleGossip({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const replicationProfile = getReplicationProfile(state);
  if (!isGossipEnabled(replicationProfile)) {
    return sendJson(res, 403, {
      error: 'gossip_disabled',
      message: 'Gossip ingestion is disabled in centralized data mode.',
      replication: replicationProfile,
    });
  }
  const body = await readRequestBody(req);
  const result = await ingestLedgerGossip({
    state,
    envelope: body.envelope,
    hashes: body.hashes,
    peerHint: body.peer,
    statusHint: body.status,
  });
  return sendJson(res, result.statusCode, result.payload);
}

export function exportLedger({ res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const envelope = buildLedgerEnvelope(state);
  return sendJson(res, 200, {
    entries: envelope.entries,
    envelope,
    ledgerHash: envelope.ledgerHash,
    replication: getReplicationProfile(state),
  });
}

export function listPeers({ res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  return sendJson(res, 200, { peers: [...state.peers], replication: getReplicationProfile(state) });
}

export async function registerPeer({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const body = await readRequestBody(req);
  await ingestLedgerGossip({
    state,
    hashes: [],
    peerHint: body.peer,
    statusHint: 'validated',
  });
  return sendJson(res, 200, { peers: [...state.peers], replication: getReplicationProfile(state) });
}
