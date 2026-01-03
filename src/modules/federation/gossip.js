import { POLICIES } from '../../config.js';
import { persistSettings } from '../../infra/persistence/storage.js';
import { buildLedgerEnvelope } from '../circle/federation.js';
import { getEffectivePolicy } from '../circle/policy.js';
import { isModuleEnabled } from '../circle/modules.js';
import { buildVoteEnvelope } from '../votes/voteEnvelope.js';
import { buildTransactionsPayload, ingestTransactionsSummary } from '../transactions/gossip.js';
import { ingestLedgerGossip, ingestVoteGossip } from './ingest.js';
import { collectGossipPeers } from './peers.js';
import { isPeerQuarantined, recordPeerFailure, recordPeerSuccess } from './quarantine.js';
import { filterVisibleEntries, getReplicationProfile, isGossipEnabled } from './replication.js';

const DEFAULT_TIMEOUT_MS = 8000;
const SKIPPABLE_ERRORS = new Set(['module_disabled', 'gossip_disabled']);
const SKIPPABLE_STATUS = new Set([404, 405, 410, 501]);

export { collectGossipPeers, normalizePeerUrl } from './peers.js';

export async function pushGossipNow(state, { reason = 'manual', timeoutMs = DEFAULT_TIMEOUT_MS, force = false } = {}) {
  const profile = getReplicationProfile(state);
  const startedAt = new Date().toISOString();
  const initial = state.gossipState || {};
  if (initial.running && !force) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'already_running' });
    state.gossipState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  if (!isModuleEnabled(state, 'federation')) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'federation_disabled' });
    state.gossipState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  if (!isGossipEnabled(profile)) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'gossip_disabled' });
    state.gossipState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  const peers = collectGossipPeers(state).filter((peer) => !isPeerQuarantined(state, peer).quarantined);
  if (!peers.length) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'no_peers' });
    state.gossipState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  const ledgerPayload = { envelope: buildLedgerEnvelope(state) };
  const votesPayload = buildVotesPayload(state);
  const transactionsPayload = buildTransactionsPayload(state);
  state.gossipState = { ...initial, running: true };

  let peerResults = [];
  let summary;
  try {
    peerResults = await Promise.all(
      peers.map((peer) => pushToPeer(peer, { ledgerPayload, votesPayload, transactionsPayload, timeoutMs })),
    );
    const finishedAt = new Date().toISOString();
    summary = summarizeResults({ peerResults, peers, reason, startedAt, finishedAt, votesPayload });
    await updatePeerHealthFromResults(state, peerResults);
    state.gossipState = updateGossipState(state.gossipState, { summary, peerResults, startedAt, finishedAt });
    return summary;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const summaryError = buildErrorSummary({
      reason,
      startedAt,
      finishedAt,
      error,
      peers,
    });
    state.gossipState = updateGossipState(state.gossipState, {
      summary: summaryError,
      peerResults,
      startedAt,
      finishedAt,
    });
    return summaryError;
  } finally {
    state.gossipState = { ...(state.gossipState || {}), running: false };
  }
}

export async function pullGossipNow(state, { reason = 'manual', timeoutMs = DEFAULT_TIMEOUT_MS, force = false } = {}) {
  const profile = getReplicationProfile(state);
  const startedAt = new Date().toISOString();
  const initial = state.gossipPullState || {};
  if (initial.running && !force) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'already_running' });
    state.gossipPullState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  if (!isModuleEnabled(state, 'federation')) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'federation_disabled' });
    state.gossipPullState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  if (!isGossipEnabled(profile)) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'gossip_disabled' });
    state.gossipPullState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  const peers = collectGossipPeers(state).filter((peer) => !isPeerQuarantined(state, peer).quarantined);
  if (!peers.length) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'no_peers' });
    state.gossipPullState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  state.gossipPullState = { ...initial, running: true };
  let peerResults = [];
  let summary;

  try {
    for (const peer of peers) {
      const result = await pullFromPeer(state, peer, { timeoutMs });
      peerResults.push(result);
    }
    const finishedAt = new Date().toISOString();
    summary = summarizePullResults({ peerResults, peers, reason, startedAt, finishedAt });
    await updatePeerHealthFromResults(state, peerResults);
    state.gossipPullState = updateGossipState(state.gossipPullState, { summary, peerResults, startedAt, finishedAt });
    return summary;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const summaryError = buildErrorSummary({
      reason,
      startedAt,
      finishedAt,
      error,
      peers,
    });
    state.gossipPullState = updateGossipState(state.gossipPullState, {
      summary: summaryError,
      peerResults,
      startedAt,
      finishedAt,
    });
    return summaryError;
  } finally {
    state.gossipPullState = { ...(state.gossipPullState || {}), running: false };
  }
}

export function startGossipScheduler(state) {
  const intervalSeconds = Number.isFinite(POLICIES.gossipIntervalSeconds)
    ? POLICIES.gossipIntervalSeconds
    : 300;
  if (intervalSeconds <= 0) {
    return () => {};
  }
  const intervalMs = intervalSeconds * 1000;
  let scheduled = false;

  const tick = async () => {
    if (scheduled) return;
    if (state.gossipState?.running || state.gossipPullState?.running) return;
    scheduled = true;
    try {
      await pushGossipNow(state, { reason: 'scheduled' });
      await pullGossipNow(state, { reason: 'scheduled' });
    } finally {
      scheduled = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  setTimeout(tick, Math.min(2000, intervalMs));
  return () => clearInterval(timer);
}

function buildVotesPayload(state) {
  if (!isModuleEnabled(state, 'votes')) return null;
  const policy = getEffectivePolicy(state);
  const entries = filterVisibleEntries(state.votes || [], state).map(
    (vote) => vote.envelope || buildVoteEnvelope(vote, { policy, issuer: state.issuer }),
  );
  if (!entries.length) return null;
  return { entries };
}

async function pushToPeer(peer, { ledgerPayload, votesPayload, transactionsPayload, timeoutMs }) {
  const ledger = await sendPayload(peer, '/circle/gossip', ledgerPayload, timeoutMs);
  const votes = await sendPayload(peer, '/votes/gossip', votesPayload, timeoutMs, { skipNotFound: true });
  const transactions = await sendPayload(peer, '/transactions/gossip', transactionsPayload, timeoutMs, { skipNotFound: true });
  return { peer, ledger, votes, transactions };
}

async function sendPayload(peer, path, payload, timeoutMs, { skipNotFound = false } = {}) {
  if (!payload) {
    return { skipped: true };
  }
  const url = `${peer}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    let payloadBody = null;
    if (contentType.includes('application/json')) {
      try {
        payloadBody = await response.json();
      } catch (_error) {
        payloadBody = null;
      }
    }
    let error = null;
    if (!response.ok && payloadBody && typeof payloadBody === 'object') {
      error = payloadBody.error || payloadBody.message || null;
    }
    const skipped = shouldSkipResponse(response.status, error, { skipNotFound });
    const result = { ok: response.ok, status: response.status, error: error || undefined, skipped };
    if (payloadBody && typeof payloadBody === 'object') {
      const added = Number(payloadBody.added);
      const updated = Number(payloadBody.updated);
      const rejected = Number(payloadBody.rejected);
      if (Number.isFinite(added)) result.added = added;
      if (Number.isFinite(updated)) result.updated = updated;
      if (Number.isFinite(rejected)) result.rejected = rejected;
      if (payloadBody.ledgerHash) result.ledgerHash = payloadBody.ledgerHash;
    }
    return result;
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function pullFromPeer(state, peer, { timeoutMs }) {
  const ledgerResponse = await fetchJson(`${peer}/circle/ledger`, timeoutMs);
  let ledger = { ok: false, status: ledgerResponse.status, error: ledgerResponse.error };
  if (shouldSkipResponse(ledgerResponse.status, ledgerResponse.error)) {
    ledger = { skipped: true, status: ledgerResponse.status, error: ledgerResponse.error };
  } else if (ledgerResponse.ok && ledgerResponse.payload) {
    const payload = ledgerResponse.payload;
    const envelope = payload.envelope || buildEnvelopeFromPayload(payload, peer);
    if (envelope || Array.isArray(payload.entries)) {
      const ingest = await ingestLedgerGossip({
        state,
        envelope,
        hashes: payload.entries,
        peerHint: peer,
        statusHint: payload.status,
      });
      ledger = mapIngestResult(ledgerResponse, ingest, payload);
    } else {
      ledger = { ok: false, status: ledgerResponse.status, error: 'invalid_payload' };
    }
  }

  let votes = { skipped: true };
  if (isModuleEnabled(state, 'votes')) {
    const votesResponse = await fetchJson(`${peer}/votes/ledger`, timeoutMs);
    votes = { ok: false, status: votesResponse.status, error: votesResponse.error };
    if (shouldSkipResponse(votesResponse.status, votesResponse.error, { skipNotFound: true })) {
      votes = { skipped: true, status: votesResponse.status, error: votesResponse.error };
    } else if (votesResponse.ok && votesResponse.payload) {
      const entries = Array.isArray(votesResponse.payload.entries) ? votesResponse.payload.entries : [];
      const ingest = await ingestVoteGossip({
        state,
        envelopes: entries,
        statusHint: votesResponse.payload.status,
        peerHint: peer,
      });
      votes = {
        ok: true,
        status: votesResponse.status,
        added: ingest.added,
        updated: ingest.updated,
      };
    }
  }

  let transactions = { skipped: true };
  if (isModuleEnabled(state, 'federation')) {
    const transactionsResponse = await fetchJson(`${peer}/transactions/ledger`, timeoutMs);
    transactions = { ok: false, status: transactionsResponse.status, error: transactionsResponse.error };
    if (shouldSkipResponse(transactionsResponse.status, transactionsResponse.error, { skipNotFound: true })) {
      transactions = { skipped: true, status: transactionsResponse.status, error: transactionsResponse.error };
    } else if (transactionsResponse.ok && transactionsResponse.payload) {
      const envelope = transactionsResponse.payload.envelope || transactionsResponse.payload;
      const ingest = await ingestTransactionsSummary({
        state,
        envelope,
        statusHint: transactionsResponse.payload.status,
        peerHint: peer,
      });
      transactions = {
        ok: ingest.statusCode < 400,
        status: ingest.statusCode,
        added: ingest.payload?.added || 0,
        updated: ingest.payload?.updated || 0,
      };
    }
  }

  return { peer, ledger, votes, transactions };
}

function buildEnvelopeFromPayload(payload, peer) {
  if (!Array.isArray(payload.entries)) return null;
  return {
    issuer: payload.issuer || peer,
    issuedAt: payload.issuedAt || new Date().toISOString(),
    status: payload.status || 'validated',
    policy: payload.policy || {},
    entries: payload.entries,
    ledgerHash: payload.ledgerHash,
  };
}

function mapIngestResult(response, ingest, payload) {
  if (!ingest || !response) {
    return { ok: false, status: response?.status, error: 'ingest_failed' };
  }
  if (ingest.statusCode >= 400) {
    return { ok: false, status: ingest.statusCode, error: ingest.payload?.error || 'ingest_failed' };
  }
  return {
    ok: true,
    status: ingest.statusCode,
    added: ingest.payload?.added || 0,
    ledgerHash: payload?.ledgerHash || ingest.payload?.ledgerHash,
  };
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    let error = null;
    if (!response.ok && payload && typeof payload === 'object') {
      error = payload.error || payload.message || null;
    }
    return { ok: response.ok, status: response.status, payload, error: error || undefined };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResults({ peerResults, peers, reason, startedAt, finishedAt, votesPayload }) {
  const hasVotesPayload = Boolean(votesPayload);
  const ledger = { sent: peers.length, ok: 0, failed: 0, added: 0 };
  const votes = {
    sent: hasVotesPayload ? peers.length : 0,
    ok: 0,
    failed: 0,
    skipped: !hasVotesPayload,
    added: 0,
    updated: 0,
  };
  const transactions = {
    sent: peers.length,
    ok: 0,
    failed: 0,
    skipped: false,
    added: 0,
    updated: 0,
  };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
    } else if (result.ledger?.ok) {
      ledger.ok += 1;
      if (Number.isFinite(result.ledger.added)) {
        ledger.added += result.ledger.added;
      }
    } else {
      ledger.failed += 1;
      errors.push(buildError(result, 'ledger'));
    }

    if (result.votes?.skipped) {
      if (hasVotesPayload) {
        votes.sent -= 1;
      }
      votes.skipped = true;
      continue;
    }
    if (result.votes?.ok) {
      votes.ok += 1;
      if (Number.isFinite(result.votes.added)) {
        votes.added += result.votes.added;
      }
      if (Number.isFinite(result.votes.updated)) {
        votes.updated += result.votes.updated;
      }
    } else {
      votes.failed += 1;
      errors.push(buildError(result, 'votes'));
    }

    if (result.transactions?.skipped) {
      transactions.sent -= 1;
      transactions.skipped = true;
    } else if (result.transactions?.ok) {
      transactions.ok += 1;
      if (Number.isFinite(result.transactions.added)) {
        transactions.added += result.transactions.added;
      }
      if (Number.isFinite(result.transactions.updated)) {
        transactions.updated += result.transactions.updated;
      }
    } else if (result.transactions) {
      transactions.failed += 1;
      errors.push(buildError(result, 'transactions'));
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    reason,
    startedAt,
    finishedAt,
    peers: peers.length,
    ledger,
    votes,
    transactions,
    errors,
  };
}

function summarizePullResults({ peerResults, peers, reason, startedAt, finishedAt }) {
  const ledger = { sent: peers.length, ok: 0, failed: 0, added: 0 };
  const votes = { sent: peers.length, ok: 0, failed: 0, skipped: false, added: 0, updated: 0 };
  const transactions = { sent: peers.length, ok: 0, failed: 0, skipped: false, added: 0, updated: 0 };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
    } else if (result.ledger?.ok) {
      ledger.ok += 1;
      if (Number.isFinite(result.ledger.added)) {
        ledger.added += result.ledger.added;
      }
    } else {
      ledger.failed += 1;
      errors.push(buildError(result, 'ledger'));
    }

    if (result.votes?.skipped) {
      votes.sent -= 1;
      votes.skipped = true;
      continue;
    }
    if (result.votes?.ok) {
      votes.ok += 1;
      if (Number.isFinite(result.votes.added)) {
        votes.added += result.votes.added;
      }
      if (Number.isFinite(result.votes.updated)) {
        votes.updated += result.votes.updated;
      }
    } else {
      votes.failed += 1;
      errors.push(buildError(result, 'votes'));
    }

    if (result.transactions?.skipped) {
      transactions.sent -= 1;
      transactions.skipped = true;
      continue;
    }
    if (result.transactions?.ok) {
      transactions.ok += 1;
      if (Number.isFinite(result.transactions.added)) {
        transactions.added += result.transactions.added;
      }
      if (Number.isFinite(result.transactions.updated)) {
        transactions.updated += result.transactions.updated;
      }
    } else if (result.transactions) {
      transactions.failed += 1;
      errors.push(buildError(result, 'transactions'));
    }
  }

  const ok = errors.length === 0;
  return {
    ok,
    reason,
    startedAt,
    finishedAt,
    peers: peers.length,
    ledger,
    votes,
    transactions,
    errors,
  };
}

function buildError(result, scope) {
  const entry = result[scope] || {};
  const status = entry.status ? `status ${entry.status}` : null;
  const message = entry.error || status || 'failed';
  return { peer: result.peer, scope, error: message };
}

function buildSkippedSummary({ reason, startedAt, finishedAt, skip }) {
  return {
    ok: false,
    reason,
    startedAt,
    finishedAt,
    peers: 0,
    ledger: { sent: 0, ok: 0, failed: 0, added: 0 },
    votes: { sent: 0, ok: 0, failed: 0, skipped: true, added: 0, updated: 0 },
    transactions: { sent: 0, ok: 0, failed: 0, skipped: true, added: 0, updated: 0 },
    errors: [],
    skipped: skip,
  };
}

function buildErrorSummary({ reason, startedAt, finishedAt, error, peers }) {
  return {
    ok: false,
    reason,
    startedAt,
    finishedAt,
    peers: peers.length,
    ledger: { sent: peers.length, ok: 0, failed: peers.length, added: 0 },
    votes: { sent: peers.length, ok: 0, failed: peers.length, skipped: false, added: 0, updated: 0 },
    transactions: { sent: peers.length, ok: 0, failed: peers.length, skipped: false, added: 0, updated: 0 },
    errors: [{ peer: 'scheduler', scope: 'gossip', error: error?.message || String(error) }],
  };
}

function updateGossipState(current, { summary, peerResults, startedAt, finishedAt }) {
  const next = {
    ...(current || {}),
    lastAttemptAt: startedAt,
    lastSummary: summary,
    peerResults,
  };
  if (summary?.ok) {
    next.lastSuccessAt = finishedAt;
  }
  if (summary?.errors?.length) {
    next.lastErrorAt = finishedAt;
    next.lastError = summary.errors[0].error;
  }
  return next;
}

async function updatePeerHealthFromResults(state, peerResults = []) {
  let updated = false;
  for (const result of peerResults) {
    if (!result?.peer) continue;
    const outcome = classifyPeerOutcome(result);
    if (!outcome) continue;
    if (outcome.ok) {
      updated = recordPeerSuccess(state, result.peer).updated || updated;
    } else {
      updated = recordPeerFailure(state, result.peer, { reason: outcome.reason, penalty: 1 }).updated || updated;
    }
  }
  if (updated) {
    await persistSettings(state);
  }
}

function classifyPeerOutcome(result) {
  const ledger = result.ledger || {};
  const votes = result.votes || {};
  const transactions = result.transactions || {};
  if (ledger.skipped && votes.skipped && transactions.skipped) return null;

  if (!ledger.skipped && !ledger.ok) {
    return { ok: false, reason: describeFailure('ledger', ledger) };
  }
  if (!votes.skipped && !votes.ok) {
    return { ok: false, reason: describeFailure('votes', votes) };
  }
  if (!transactions.skipped && !transactions.ok) {
    return { ok: false, reason: describeFailure('transactions', transactions) };
  }
  return { ok: true };
}

function describeFailure(scope, status) {
  if (status?.error) return `${scope}_${status.error}`;
  if (status?.status) return `${scope}_status_${status.status}`;
  return `${scope}_failed`;
}

function shouldSkipResponse(status, error, { skipNotFound = false } = {}) {
  if (skipNotFound && SKIPPABLE_STATUS.has(status)) return true;
  if (status !== 403) return false;
  const normalized = String(error || '').trim().toLowerCase();
  if (!normalized) return false;
  if (SKIPPABLE_ERRORS.has(normalized)) return true;
  if (normalized.includes('module disabled') || normalized.includes('gossip disabled')) return true;
  if (normalized.includes('gossip ingestion is disabled')) return true;
  return false;
}
