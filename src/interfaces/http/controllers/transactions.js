import { listTransactions, exportTransactionsEnvelope } from '../../../modules/transactions/registry.js';
import { ingestTransactionsSummary } from '../../../modules/transactions/gossip.js';
import { getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sendJson } from '../../../shared/utils/http.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export function renderTransactions({ res, state, url }) {
  const type = url.searchParams.get('type') || null;
  const limit = Number(url.searchParams.get('limit') || 50);
  const entries = listTransactions(state, { type, limit: Number.isFinite(limit) ? limit : 50 });
  return sendJson(res, 200, { transactions: entries });
}

export function exportTransactions({ res, state, url }) {
  const limit = Number(url.searchParams.get('limit') || 100);
  const envelope = exportTransactionsEnvelope(state, { limit: Number.isFinite(limit) ? limit : 100 });
  return sendJson(res, 200, envelope);
}

export function exportTransactionsLedger({ res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const envelope = exportTransactionsEnvelope(state, { limit: 100 });
  return sendJson(res, 200, { envelope, replication: getReplicationProfile(state) });
}

export async function gossipTransactions({ req, res, state }) {
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
  const result = await ingestTransactionsSummary({
    state,
    envelope: body.envelope,
    peerHint: body.peer,
    statusHint: body.status,
  });
  const payload = result.payload ? { ...result.payload } : {};
  if (!payload.replication) {
    payload.replication = profile;
  }
  return sendJson(res, result.statusCode || 200, payload);
}
