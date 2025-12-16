import { persistLedger, persistPeers } from '../../infra/persistence/storage.js';
import { sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { buildLedgerEnvelope, verifyLedgerEnvelope } from '../../modules/circle/federation.js';

export async function handleGossip({ req, res, state }) {
  const body = await readRequestBody(req);
  const envelope = body.envelope;
  const verification = envelope ? verifyLedgerEnvelope(envelope) : null;

  if (verification && !verification.valid && !verification.skipped) {
    return sendJson(res, 400, { error: 'invalid_signature', detail: 'Ledger envelope signature rejected.' });
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
    verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
  });
}

export function exportLedger({ res, state }) {
  const envelope = buildLedgerEnvelope(state);
  return sendJson(res, 200, { entries: [...state.uniquenessLedger], envelope });
}

export function listPeers({ res, state }) {
  return sendJson(res, 200, { peers: [...state.peers] });
}

export async function registerPeer({ req, res, state }) {
  const body = await readRequestBody(req);
  if (body.peer) {
    state.peers.add(String(body.peer));
    await persistPeers(state);
  }
  return sendJson(res, 200, { peers: [...state.peers] });
}
