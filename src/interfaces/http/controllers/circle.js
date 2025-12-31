import { persistLedger, persistPeers } from '../../../infra/persistence/storage.js';
import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { buildLedgerEnvelope, computeLedgerHash, verifyLedgerEnvelope } from '../../../modules/circle/federation.js';
import { decideStatus, getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { normalizePeerUrl } from '../../../modules/federation/gossip.js';
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
  const envelope = body.envelope;
  const replicationStatus = decideStatus(replicationProfile, envelope?.status || body.status || 'validated');
  const verification = envelope ? verifyLedgerEnvelope(envelope) : null;
  const preLedgerHash = computeLedgerHash([...state.uniquenessLedger]);

  if (verification && !verification.valid && !verification.skipped) {
    return sendJson(res, 400, { error: 'invalid_signature', detail: 'Ledger envelope signature rejected.' });
  }

  if (replicationStatus.status === 'rejected') {
    return sendJson(res, 202, {
      added: 0,
      total: state.uniquenessLedger.size,
      peers: [...state.peers],
      ledgerHash: preLedgerHash,
      replication: { status: replicationStatus, profile: replicationProfile },
      verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
      detail: 'Incoming payload marked as preview and previews are disabled.',
    });
  }

  const hashes = envelope ? (Array.isArray(envelope.entries) ? envelope.entries : []) : Array.isArray(body.hashes) ? body.hashes : [];
  if (envelope?.ledgerHash) {
    const expected = computeLedgerHash(hashes);
    if (expected !== envelope.ledgerHash) {
      return sendJson(res, 400, {
        error: 'ledger_hash_mismatch',
        detail: 'Ledger digest did not match entry list.',
        ledgerHash: preLedgerHash,
      });
    }
  }
  let added = 0;
  for (const hash of hashes) {
    if (!state.uniquenessLedger.has(hash)) {
      state.uniquenessLedger.add(hash);
      added += 1;
    }
  }

  const peerHint = envelope?.issuer || body.peer;
  const normalizedPeer = normalizePeerUrl(peerHint);
  if (normalizedPeer && !state.peers.has(normalizedPeer)) {
    state.peers.add(normalizedPeer);
    await persistPeers(state);
  }
  if (added > 0) {
    await persistLedger(state);
  }
  const localLedgerHash = computeLedgerHash([...state.uniquenessLedger]);
  return sendJson(res, 200, {
    added,
    total: state.uniquenessLedger.size,
    peers: [...state.peers],
    ledgerHash: localLedgerHash,
    replication: { status: replicationStatus, profile: replicationProfile },
    verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
  });
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
  const normalizedPeer = normalizePeerUrl(body.peer);
  if (normalizedPeer && !state.peers.has(normalizedPeer)) {
    state.peers.add(normalizedPeer);
    await persistPeers(state);
  }
  return sendJson(res, 200, { peers: [...state.peers], replication: getReplicationProfile(state) });
}
