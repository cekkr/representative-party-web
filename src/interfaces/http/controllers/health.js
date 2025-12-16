import { POLICIES } from '../../config.js';
import { filterVisibleEntries, getReplicationProfile } from '../../modules/federation/replication.js';
import { buildPolicyGates, getCirclePolicyState } from '../../modules/circle/policy.js';
import { sendJson } from '../../shared/utils/http.js';

export function renderHealth({ res, state }) {
  return sendJson(res, 200, {
    status: 'ok',
    ledger: state.uniquenessLedger.size,
    sessions: state.sessions.size,
    peers: state.peers.size,
    actors: state.actors.size,
    discussions: state.discussions.length,
    petitions: state.petitions.length,
    votes: state.votes.length,
    delegations: state.delegations.length,
    notifications: state.notifications.length,
    groups: state.groups.length,
    visible: {
      discussions: filterVisibleEntries(state.discussions, state).length,
      petitions: filterVisibleEntries(state.petitions, state).length,
      votes: filterVisibleEntries(state.votes, state).length,
      groups: filterVisibleEntries(state.groups, state).length,
    },
    policy: getCirclePolicyState(state),
    gates: buildPolicyGates(state),
    data: getReplicationProfile(state),
    extensions: (state.extensions?.active || []).map((ext) => ({ id: ext.id, meta: ext.meta || {} })),
    policies: POLICIES,
    schemaVersion: state.meta?.schemaVersion || 0,
    now: new Date().toISOString(),
  });
}
