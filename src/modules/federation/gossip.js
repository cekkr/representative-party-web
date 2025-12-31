import { POLICIES } from '../../config.js';
import { buildLedgerEnvelope } from '../circle/federation.js';
import { isModuleEnabled } from '../circle/modules.js';
import { buildVoteEnvelope } from '../votes/voteEnvelope.js';
import { ingestLedgerGossip, ingestVoteGossip } from './ingest.js';
import { collectGossipPeers } from './peers.js';
import { filterVisibleEntries, getReplicationProfile, isGossipEnabled } from './replication.js';

const DEFAULT_TIMEOUT_MS = 8000;

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

  const peers = collectGossipPeers(state);
  if (!peers.length) {
    const summary = buildSkippedSummary({ reason, startedAt, finishedAt: startedAt, skip: 'no_peers' });
    state.gossipState = { ...initial, lastAttemptAt: startedAt, lastSummary: summary };
    return summary;
  }

  const ledgerPayload = { envelope: buildLedgerEnvelope(state) };
  const votesPayload = buildVotesPayload(state);
  state.gossipState = { ...initial, running: true };

  let peerResults = [];
  let summary;
  try {
    peerResults = await Promise.all(
      peers.map((peer) => pushToPeer(peer, { ledgerPayload, votesPayload, timeoutMs })),
    );
    const finishedAt = new Date().toISOString();
    summary = summarizeResults({ peerResults, peers, reason, startedAt, finishedAt, votesPayload });
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

  const peers = collectGossipPeers(state);
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
  const entries = filterVisibleEntries(state.votes || [], state).map((vote) => vote.envelope || buildVoteEnvelope(vote));
  if (!entries.length) return null;
  return { entries };
}

async function pushToPeer(peer, { ledgerPayload, votesPayload, timeoutMs }) {
  const ledger = await sendPayload(peer, '/circle/gossip', ledgerPayload, timeoutMs);
  const votes = await sendPayload(peer, '/votes/gossip', votesPayload, timeoutMs);
  return { peer, ledger, votes };
}

async function sendPayload(peer, path, payload, timeoutMs) {
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
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function pullFromPeer(state, peer, { timeoutMs }) {
  const ledgerResponse = await fetchJson(`${peer}/circle/ledger`, timeoutMs);
  let ledger = { ok: false, status: ledgerResponse.status, error: ledgerResponse.error };
  if (ledgerResponse.ok && ledgerResponse.payload) {
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
    if (votesResponse.ok && votesResponse.payload) {
      const entries = Array.isArray(votesResponse.payload.entries) ? votesResponse.payload.entries : [];
      const ingest = await ingestVoteGossip({ state, envelopes: entries, statusHint: votesResponse.payload.status });
      votes = {
        ok: true,
        status: votesResponse.status,
        added: ingest.added,
      };
    }
  }

  return { peer, ledger, votes };
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
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResults({ peerResults, peers, reason, startedAt, finishedAt, votesPayload }) {
  const ledger = { sent: peers.length, ok: 0, failed: 0 };
  const votes = {
    sent: votesPayload ? peers.length : 0,
    ok: 0,
    failed: 0,
    skipped: !votesPayload,
  };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
    } else if (result.ledger?.ok) {
      ledger.ok += 1;
    } else {
      ledger.failed += 1;
      errors.push(buildError(result, 'ledger'));
    }

    if (result.votes?.skipped) {
      continue;
    }
    if (result.votes?.ok) {
      votes.ok += 1;
    } else {
      votes.failed += 1;
      errors.push(buildError(result, 'votes'));
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
    errors,
  };
}

function summarizePullResults({ peerResults, peers, reason, startedAt, finishedAt }) {
  const ledger = { sent: peers.length, ok: 0, failed: 0 };
  const votes = { sent: peers.length, ok: 0, failed: 0, skipped: false };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
    } else if (result.ledger?.ok) {
      ledger.ok += 1;
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
    } else {
      votes.failed += 1;
      errors.push(buildError(result, 'votes'));
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
    ledger: { sent: 0, ok: 0, failed: 0 },
    votes: { sent: 0, ok: 0, failed: 0, skipped: true },
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
    ledger: { sent: peers.length, ok: 0, failed: peers.length },
    votes: { sent: peers.length, ok: 0, failed: peers.length, skipped: false },
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
