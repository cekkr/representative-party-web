import { listTransactions, exportTransactionsEnvelope } from '../../modules/transactions/registry.js';
import { sendJson } from '../../shared/utils/http.js';

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
