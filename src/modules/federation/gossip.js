import { POLICIES } from '../../config.js';
import { buildLedgerEnvelope } from '../circle/federation.js';
import { isModuleEnabled } from '../circle/modules.js';
import { buildVoteEnvelope } from '../votes/voteEnvelope.js';
import { filterVisibleEntries, getReplicationProfile, isGossipEnabled } from './replication.js';

const DEFAULT_TIMEOUT_MS = 8000;

export function normalizePeerUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(trimmed);
    const isHostLike = /^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(trimmed);
    if (!isLocal && (!isHostLike || !trimmed.includes('.'))) {
      return null;
    }
    normalized = `${isLocal ? 'http' : 'https'}://${trimmed}`;
  }
  return normalized.replace(/\/+$/, '');
}

export function collectGossipPeers(state) {
  const peers = new Set();
  const rawPeers = [];
  if (state?.peers) {
    rawPeers.push(...state.peers);
  }
  if (state?.settings?.preferredPeer) {
    rawPeers.push(state.settings.preferredPeer);
  }
  for (const peer of rawPeers) {
    const normalized = normalizePeerUrl(peer);
    if (normalized) peers.add(normalized);
  }
  return [...peers];
}

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
    if (state.gossipState?.running) return;
    scheduled = true;
    try {
      await pushGossipNow(state, { reason: 'scheduled' });
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
