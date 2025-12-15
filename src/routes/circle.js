import { persistLedger, persistPeers } from '../state/storage.js';
import { sendJson } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';

export async function handleGossip({ req, res, state }) {
  const body = await readRequestBody(req);
  const hashes = Array.isArray(body.hashes) ? body.hashes : [];
  let added = 0;
  for (const hash of hashes) {
    if (!state.uniquenessLedger.has(hash)) {
      state.uniquenessLedger.add(hash);
      added += 1;
    }
  }
  if (body.peer) {
    state.peers.add(String(body.peer));
    await persistPeers(state);
  }
  if (added > 0) {
    await persistLedger(state);
  }
  return sendJson(res, 200, { added, total: state.uniquenessLedger.size, peers: [...state.peers] });
}

export function exportLedger({ res, state }) {
  return sendJson(res, 200, { entries: [...state.uniquenessLedger] });
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
