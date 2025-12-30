import { persistLedger, persistPeers } from '../../infra/persistence/storage.js';
import { sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { buildLedgerEnvelope, verifyLedgerEnvelope } from '../../modules/circle/federation.js';
import { decideStatus, getReplicationProfile } from '../../modules/federation/replication.js';
import { isModuleEnabled } from '../../modules/circle/modules.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export async function handleGossip({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const body = await readRequestBody(req);
  const envelope = body.envelope;
  const replicationProfile = getReplicationProfile(state);
  const replicationStatus = decideStatus(replicationProfile, envelope?.status || body.status || 'validated');
  const verification = envelope ? verifyLedgerEnvelope(envelope) : null;

  if (verification && !verification.valid && !verification.skipped) {
    return sendJson(res, 400, { error: 'invalid_signature', detail: 'Ledger envelope signature rejected.' });
  }

  if (replicationStatus.status === 'rejected') {
    return sendJson(res, 202, {
      added: 0,
      total: state.uniquenessLedger.size,
      peers: [...state.peers],
      replication: { status: replicationStatus, profile: replicationProfile },
      verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
      detail: 'Incoming payload marked as preview and previews are disabled.',
    });
  }

  const hashes = envelope ? (Array.isArray(envelope.entries) ? envelope.entries : []) : Array.isArray(body.hashes) ? body.hashes : [];
  let added = 0;
  for (const hash of hashes) {
    if (!state.uniquenessLedger.has(hash)) {
      state.uniquenessLedger.add(hash);
      added += 1;
    }
  }

  const peerHint = envelope?.issuer || body.peer;
  if (peerHint) {
    state.peers.add(String(peerHint));
    await persistPeers(state);
  }
  if (added > 0) {
    await persistLedger(state);
  }
  return sendJson(res, 200, {
    added,
    total: state.uniquenessLedger.size,
    peers: [...state.peers],
    replication: { status: replicationStatus, profile: replicationProfile },
    verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
  });
}

export function exportLedger({ res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const envelope = buildLedgerEnvelope(state);
  return sendJson(res, 200, { entries: [...state.uniquenessLedger], envelope, replication: getReplicationProfile(state) });
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
  if (body.peer) {
    state.peers.add(String(body.peer));
    await persistPeers(state);
  }
  return sendJson(res, 200, { peers: [...state.peers], replication: getReplicationProfile(state) });
}
