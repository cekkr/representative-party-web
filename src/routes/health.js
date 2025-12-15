import { POLICIES } from '../config.js';
import { buildPolicyGates, getCirclePolicyState } from '../services/policy.js';
import { sendJson } from '../utils/http.js';

export function renderHealth({ res, state }) {
  return sendJson(res, 200, {
    status: 'ok',
    ledger: state.uniquenessLedger.size,
    sessions: state.sessions.size,
    peers: state.peers.size,
    actors: state.actors.size,
    discussions: state.discussions.length,
    policy: getCirclePolicyState(state),
    gates: buildPolicyGates(state),
    policies: POLICIES,
    schemaVersion: state.meta?.schemaVersion || 0,
    now: new Date().toISOString(),
  });
}
