import { POLICIES } from '../config.js';
import { sendJson } from '../utils/http.js';

export function renderHealth({ res, state }) {
  return sendJson(res, 200, {
    status: 'ok',
    ledger: state.uniquenessLedger.size,
    sessions: state.sessions.size,
    peers: state.peers.size,
    actors: state.actors.size,
    discussions: state.discussions.length,
    policies: POLICIES,
    now: new Date().toISOString(),
  });
}
