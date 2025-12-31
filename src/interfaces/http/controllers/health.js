import { POLICIES } from '../../../config.js';
import { computeLedgerHash } from '../../../modules/circle/federation.js';
import { filterVisibleEntries, getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { listPeerHealth, summarizePeerHealth } from '../../../modules/federation/quarantine.js';
import { buildPolicyGates, getCirclePolicyState } from '../../../modules/circle/policy.js';
import { sendJson } from '../../../shared/utils/http.js';

export function renderHealth({ res, state }) {
  const replication = getReplicationProfile(state);
  const outboundSummary = formatGossipState(state.gossipState);
  const pullSummary = formatGossipState(state.gossipPullState);
  const peerHealthSummary = summarizePeerHealth(listPeerHealth(state), { limit: 20 });
  return sendJson(res, 200, {
    status: 'ok',
    ledger: state.uniquenessLedger.size,
    ledgerHash: computeLedgerHash([...state.uniquenessLedger]),
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
    data: replication,
    gossip: {
      ingestEnabled: isGossipEnabled(replication),
      outbound: outboundSummary,
      pull: pullSummary,
      peerHealth: peerHealthSummary,
    },
    extensions: (state.extensions?.active || []).map((ext) => ({ id: ext.id, meta: ext.meta || {} })),
    policies: POLICIES,
    schemaVersion: state.meta?.schemaVersion || 0,
    now: new Date().toISOString(),
    auditLog: (state.settings?.auditLog || []).slice(-10),
    transactions: {
      count: state.transactions?.length || 0,
      summaries: filterVisibleEntries(state.transactionSummaries || [], state).length,
      recent: (state.transactions || []).slice(0, 5).map((t) => ({ id: t.id, type: t.type, digest: t.digest, at: t.createdAt })),
    },
  });
}

function formatGossipState(gossipState = {}) {
  if (!gossipState || !gossipState.lastSummary) return null;
  return {
    lastAttemptAt: gossipState.lastAttemptAt || null,
    lastSuccessAt: gossipState.lastSuccessAt || null,
    lastErrorAt: gossipState.lastErrorAt || null,
    lastError: gossipState.lastError || null,
    running: Boolean(gossipState.running),
    summary: {
      peers: gossipState.lastSummary.peers,
      ledger: gossipState.lastSummary.ledger,
      votes: gossipState.lastSummary.votes,
      transactions: gossipState.lastSummary.transactions,
      skipped: gossipState.lastSummary.skipped || null,
      reason: gossipState.lastSummary.reason,
    },
  };
}
