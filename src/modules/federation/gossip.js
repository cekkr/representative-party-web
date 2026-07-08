import { POLICIES } from '../../config.js';
import { persistSettings } from '../../infra/persistence/storage.js';
import { buildLedgerEnvelope, computeLedgerHash } from '../circle/federation.js';
import { getEffectivePolicy } from '../circle/policy.js';
import { isModuleEnabled } from '../circle/modules.js';
import { buildProviderBlindAnnouncement } from '../circle/ringRegistry.js';
import { buildVoteEnvelope } from '../votes/voteEnvelope.js';
import { buildTransactionsPayload, ingestTransactionsSummary } from '../transactions/gossip.js';
import { ingestLedgerGossip, ingestVoteGossip } from './ingest.js';
import { collectGossipPeers } from './peers.js';
import { isPeerQuarantined, recordPeerFailure, recordPeerLedger, recordPeerSuccess } from './quarantine.js';
import { getPeerCapabilities } from './capabilities.js';
import { filterVisibleEntries, getReplicationProfile, isGossipEnabled } from './replication.js';

const DEFAULT_TIMEOUT_MS = 8000;
const SKIPPABLE_ERRORS = new Set(['module_disabled', 'gossip_disabled']);
const SKIPPABLE_STATUS = new Set([404, 405, 410, 501]);
const OPTIONAL_SKIP_SCOPES = ['votes', 'transactions'];
const OPTIONAL_SKIP_TTL_MS = resolveOptionalSkipTtlMs();
const OPTIONAL_SKIP_MAX_PEERS = 120;
const PUSH_SKIP_SCOPES = ['ledger', 'votes', 'transactions'];
const PUSH_SKIP_TTL_MS = OPTIONAL_SKIP_TTL_MS;
const PUSH_SKIP_MAX_PEERS = 120;

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

  const sender = state.issuer || state.settings?.issuer || 'local-circle';
  const ledgerPayload = { envelope: buildLedgerEnvelope(state), peer: sender };
  const providerBlind = buildProviderBlindAnnouncement(state.settings?.providerBlind);
  if (providerBlind) {
    ledgerPayload.providerBlind = providerBlind;
  }
  const votesPayload = buildVotesPayload(state);
  if (votesPayload) votesPayload.peer = sender;
  const transactionsPayload = buildTransactionsPayload(state);
  if (transactionsPayload) transactionsPayload.peer = sender;
  state.gossipState = { ...initial, running: true };

  let peerResults = [];
  let summary;
  try {
    const peerCapabilities = new Map(peers.map((peer) => [peer, getPeerCapabilities(state, peer)]));
    peerResults = await Promise.all(
      peers.map((peer) => {
        const capabilities = peerCapabilities.get(peer) || null;
        const payloads = selectPeerPayloads({ ledgerPayload, votesPayload, transactionsPayload, capabilities });
        return pushToPeer(state, peer, { ...payloads, timeoutMs, capabilities });
      }),
    );
    const finishedAt = new Date().toISOString();
    summary = summarizeResults({
      peerResults,
      peers,
      reason,
      startedAt,
      finishedAt,
      votesPayload,
      transactionsPayload,
    });
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
    peerResults = await Promise.all(peers.map((peer) => pullFromPeer(state, peer, { timeoutMs })));
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
  const providerBlind = state.settings?.providerBlind;
  const providerBlindMode = providerBlind?.mode || 'off';
  const useRing = providerBlindMode !== 'off';
  const entries = filterVisibleEntries(state.votes || [], state).map((vote) => {
    if (useRing && vote?.issuer === state.issuer) {
      if (!vote.envelope || !vote.envelope.ringSignature || providerBlindMode === 'strict') {
        return buildVoteEnvelope(vote, { policy, issuer: state.issuer, providerBlind });
      }
    }
    return vote.envelope || buildVoteEnvelope(vote, { policy, issuer: state.issuer, providerBlind });
  });
  if (!entries.length) return null;
  return { entries };
}

function selectPeerPayloads({ ledgerPayload, votesPayload, transactionsPayload, capabilities }) {
  if (!canSendLedger(capabilities)) {
    return { ledgerPayload: null, votesPayload: null, transactionsPayload: null };
  }
  const sendVotes = Boolean(votesPayload && canSendVotes(capabilities));
  const sendTransactions = Boolean(transactionsPayload && canSendTransactions(capabilities));
  return {
    ledgerPayload,
    votesPayload: sendVotes ? votesPayload : null,
    transactionsPayload: sendTransactions ? transactionsPayload : null,
  };
}

function canSendLedger(capabilities) {
  if (!capabilities) return true;
  const replicationMode = capabilities.replication?.mode;
  if (replicationMode === 'centralized') return false;
  if (capabilities.modules && capabilities.modules.federation === false) return false;
  return true;
}

function canSendVotes(capabilities) {
  if (!capabilities) return true;
  if (capabilities.modules?.votes === false) return false;
  if (capabilities.modules?.petitions === false) return false;
  return true;
}

function canSendTransactions(capabilities) {
  if (!capabilities) return true;
  if (capabilities.modules?.federation === false) return false;
  return true;
}

async function pushToPeer(state, peer, { ledgerPayload, votesPayload, transactionsPayload, timeoutMs, capabilities }) {
  const ledger = await sendPayload(state, peer, 'ledger', '/circle/gossip', ledgerPayload, timeoutMs, { capabilities });
  const votes = await sendPayload(state, peer, 'votes', '/votes/gossip', votesPayload, timeoutMs, {
    skipNotFound: true,
    capabilities,
  });
  const transactions = await sendPayload(
    state,
    peer,
    'transactions',
    '/transactions/gossip',
    transactionsPayload,
    timeoutMs,
    { skipNotFound: true, capabilities },
  );
  return { peer, ledger, votes, transactions };
}

async function sendPayload(state, peer, scope, path, payload, timeoutMs, { skipNotFound = false, capabilities } = {}) {
  if (!payload) {
    return { skipped: true };
  }
  const cachedSkip = readPushEndpointSkip(state, peer, scope, { capabilities });
  if (cachedSkip) {
    return { skipped: true, cached: true, status: cachedSkip.status, error: cachedSkip.reason };
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
    if (skipped) {
      markPushEndpointSkip(state, peer, scope, {
        status: response.status,
        reason: error,
      });
    } else {
      clearPushEndpointSkip(state, peer, scope);
    }
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
        providerBlind: payload.providerBlind || envelope?.providerBlind,
      });
      ledger = mapIngestResult(ledgerResponse, ingest, payload);
    } else {
      ledger = { ok: false, status: ledgerResponse.status, error: 'invalid_payload' };
    }
  }

  const capabilities = getPeerCapabilities(state, peer);

  let votes = { skipped: true };
  const canPullVotes = isModuleEnabled(state, 'votes') && canSendVotes(capabilities);
  if (canPullVotes) {
    const cachedSkip = readOptionalEndpointSkip(state, peer, 'votes', { capabilities });
    if (cachedSkip) {
      votes = { skipped: true, cached: true, status: cachedSkip.status, error: cachedSkip.reason };
    } else {
      const votesResponse = await fetchJson(`${peer}/votes/ledger`, timeoutMs);
      votes = { ok: false, status: votesResponse.status, error: votesResponse.error };
      if (shouldSkipResponse(votesResponse.status, votesResponse.error, { skipNotFound: true })) {
        markOptionalEndpointSkip(state, peer, 'votes', {
          status: votesResponse.status,
          reason: votesResponse.error,
        });
        votes = { skipped: true, status: votesResponse.status, error: votesResponse.error };
      } else if (votesResponse.ok && votesResponse.payload) {
        clearOptionalEndpointSkip(state, peer, 'votes');
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
      } else {
        clearOptionalEndpointSkip(state, peer, 'votes');
      }
    }
  }

  let transactions = { skipped: true };
  const canPullTransactions = isModuleEnabled(state, 'federation') && canSendTransactions(capabilities);
  if (canPullTransactions) {
    const cachedSkip = readOptionalEndpointSkip(state, peer, 'transactions', { capabilities });
    if (cachedSkip) {
      transactions = { skipped: true, cached: true, status: cachedSkip.status, error: cachedSkip.reason };
    } else {
      const transactionsResponse = await fetchJson(`${peer}/transactions/ledger`, timeoutMs);
      transactions = { ok: false, status: transactionsResponse.status, error: transactionsResponse.error };
      if (shouldSkipResponse(transactionsResponse.status, transactionsResponse.error, { skipNotFound: true })) {
        markOptionalEndpointSkip(state, peer, 'transactions', {
          status: transactionsResponse.status,
          reason: transactionsResponse.error,
        });
        transactions = { skipped: true, status: transactionsResponse.status, error: transactionsResponse.error };
      } else if (transactionsResponse.ok && transactionsResponse.payload) {
        clearOptionalEndpointSkip(state, peer, 'transactions');
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
      } else {
        clearOptionalEndpointSkip(state, peer, 'transactions');
      }
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
    providerBlind: payload.providerBlind || null,
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

export function summarizeOptionalEndpointSkips(state, { now = Date.now(), includeEntries = true } = {}) {
  const cache = pruneOptionalEndpointSkips(state, { now });
  const entries = [];
  for (const [peer, scopes] of Object.entries(cache)) {
    if (!scopes || typeof scopes !== 'object') continue;
    for (const scope of OPTIONAL_SKIP_SCOPES) {
      const entry = scopes[scope];
      if (!entry) continue;
      entries.push({
        peer,
        scope,
        status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
        reason: entry.reason || null,
        untilMs: Number(entry.untilMs) || now,
        expiresAt: new Date(Number(entry.untilMs) || now).toISOString(),
        updatedAt: entry.updatedAt || null,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.peer < b.peer) return -1;
    if (a.peer > b.peer) return 1;
    if (a.scope < b.scope) return -1;
    if (a.scope > b.scope) return 1;
    return 0;
  });
  return {
    peers: Object.keys(cache).length,
    total: entries.length,
    entries: includeEntries ? entries : [],
    ttlMs: OPTIONAL_SKIP_TTL_MS,
  };
}

export function summarizePushEndpointSkips(state, { now = Date.now(), includeEntries = true } = {}) {
  const cache = prunePushEndpointSkips(state, { now });
  const entries = [];
  for (const [peer, scopes] of Object.entries(cache)) {
    if (!scopes || typeof scopes !== 'object') continue;
    for (const scope of PUSH_SKIP_SCOPES) {
      const entry = scopes[scope];
      if (!entry) continue;
      entries.push({
        peer,
        scope,
        status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
        reason: entry.reason || null,
        untilMs: Number(entry.untilMs) || now,
        expiresAt: new Date(Number(entry.untilMs) || now).toISOString(),
        updatedAt: entry.updatedAt || null,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.peer < b.peer) return -1;
    if (a.peer > b.peer) return 1;
    if (a.scope < b.scope) return -1;
    if (a.scope > b.scope) return 1;
    return 0;
  });
  return {
    peers: Object.keys(cache).length,
    total: entries.length,
    entries: includeEntries ? entries : [],
    ttlMs: PUSH_SKIP_TTL_MS,
  };
}

function readOptionalEndpointSkip(state, peer, scope, { capabilities } = {}) {
  if (!peer || !OPTIONAL_SKIP_SCOPES.includes(scope)) return null;
  if (shouldBypassOptionalSkipCache(capabilities, scope)) {
    clearOptionalEndpointSkip(state, peer, scope);
    return null;
  }
  pruneOptionalEndpointSkips(state);
  const entry = state?.gossipOptionalSkips?.[peer]?.[scope];
  if (!entry) return null;
  if (!Number.isFinite(Number(entry.untilMs)) || Number(entry.untilMs) <= Date.now()) {
    clearOptionalEndpointSkip(state, peer, scope);
    return null;
  }
  return entry;
}

function markOptionalEndpointSkip(state, peer, scope, { status = 0, reason = null } = {}) {
  if (!peer || !OPTIONAL_SKIP_SCOPES.includes(scope)) return null;
  if (!Number.isFinite(OPTIONAL_SKIP_TTL_MS) || OPTIONAL_SKIP_TTL_MS <= 0) return null;
  const now = Date.now();
  const untilMs = now + OPTIONAL_SKIP_TTL_MS;
  const cleanedStatus = Number.isFinite(Number(status)) ? Number(status) : 0;
  const cleanedReason = String(reason || '').trim().slice(0, 120) || null;
  if (!state.gossipOptionalSkips || typeof state.gossipOptionalSkips !== 'object') {
    state.gossipOptionalSkips = {};
  }
  const peerEntry = state.gossipOptionalSkips[peer] && typeof state.gossipOptionalSkips[peer] === 'object'
    ? state.gossipOptionalSkips[peer]
    : {};
  peerEntry[scope] = {
    status: cleanedStatus,
    reason: cleanedReason,
    untilMs,
    updatedAt: new Date(now).toISOString(),
  };
  state.gossipOptionalSkips[peer] = peerEntry;
  pruneOptionalEndpointSkips(state, { now });
  return peerEntry[scope];
}

function clearOptionalEndpointSkip(state, peer, scope) {
  if (!peer || !OPTIONAL_SKIP_SCOPES.includes(scope)) return;
  if (!state?.gossipOptionalSkips || typeof state.gossipOptionalSkips !== 'object') return;
  const peerEntry = state.gossipOptionalSkips[peer];
  if (!peerEntry || typeof peerEntry !== 'object') return;
  delete peerEntry[scope];
  if (!Object.keys(peerEntry).length) {
    delete state.gossipOptionalSkips[peer];
    return;
  }
  state.gossipOptionalSkips[peer] = peerEntry;
}

function pruneOptionalEndpointSkips(state, { now = Date.now() } = {}) {
  if (!state.gossipOptionalSkips || typeof state.gossipOptionalSkips !== 'object') {
    state.gossipOptionalSkips = {};
    return state.gossipOptionalSkips;
  }
  const next = {};
  for (const [peer, scopes] of Object.entries(state.gossipOptionalSkips)) {
    if (!scopes || typeof scopes !== 'object') continue;
    const keep = {};
    for (const scope of OPTIONAL_SKIP_SCOPES) {
      const entry = scopes[scope];
      const untilMs = Number(entry?.untilMs || 0);
      if (!entry || !Number.isFinite(untilMs) || untilMs <= now) continue;
      keep[scope] = {
        status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
        reason: String(entry.reason || '').trim().slice(0, 120) || null,
        untilMs,
        updatedAt: entry.updatedAt || new Date(now).toISOString(),
      };
    }
    if (Object.keys(keep).length) {
      next[peer] = keep;
    }
  }

  const peers = Object.entries(next);
  if (peers.length > OPTIONAL_SKIP_MAX_PEERS) {
    peers.sort((a, b) => getPeerSkipUpdatedAtMs(b[1]) - getPeerSkipUpdatedAtMs(a[1]));
    const trimmed = peers.slice(0, OPTIONAL_SKIP_MAX_PEERS);
    const reduced = {};
    for (const [peer, entry] of trimmed) {
      reduced[peer] = entry;
    }
    state.gossipOptionalSkips = reduced;
    return state.gossipOptionalSkips;
  }

  state.gossipOptionalSkips = next;
  return state.gossipOptionalSkips;
}

function getPeerSkipUpdatedAtMs(scopes = {}) {
  let latest = 0;
  for (const scope of OPTIONAL_SKIP_SCOPES) {
    const value = Date.parse(scopes?.[scope]?.updatedAt || '');
    if (Number.isFinite(value) && value > latest) latest = value;
  }
  return latest;
}

function shouldBypassOptionalSkipCache(capabilities, scope) {
  const modules = capabilities?.modules;
  if (!modules || typeof modules !== 'object') return false;
  if (scope === 'votes') {
    const hasVotes = Object.prototype.hasOwnProperty.call(modules, 'votes');
    const hasPetitions = Object.prototype.hasOwnProperty.call(modules, 'petitions');
    if (!hasVotes && !hasPetitions) return false;
    const votesEnabled = modules.votes !== false;
    const petitionsEnabled = modules.petitions !== false;
    return votesEnabled && petitionsEnabled;
  }
  if (scope === 'transactions') {
    if (!Object.prototype.hasOwnProperty.call(modules, 'federation')) return false;
    return modules.federation !== false;
  }
  return false;
}

function readPushEndpointSkip(state, peer, scope, { capabilities } = {}) {
  if (!peer || !PUSH_SKIP_SCOPES.includes(scope)) return null;
  if (shouldBypassPushSkipCache(capabilities, scope)) {
    clearPushEndpointSkip(state, peer, scope);
    return null;
  }
  prunePushEndpointSkips(state);
  const entry = state?.gossipPushSkips?.[peer]?.[scope];
  if (!entry) return null;
  if (!Number.isFinite(Number(entry.untilMs)) || Number(entry.untilMs) <= Date.now()) {
    clearPushEndpointSkip(state, peer, scope);
    return null;
  }
  return entry;
}

function markPushEndpointSkip(state, peer, scope, { status = 0, reason = null } = {}) {
  if (!peer || !PUSH_SKIP_SCOPES.includes(scope)) return null;
  if (!Number.isFinite(PUSH_SKIP_TTL_MS) || PUSH_SKIP_TTL_MS <= 0) return null;
  const now = Date.now();
  const untilMs = now + PUSH_SKIP_TTL_MS;
  const cleanedStatus = Number.isFinite(Number(status)) ? Number(status) : 0;
  const cleanedReason = String(reason || '').trim().slice(0, 120) || null;
  if (!state.gossipPushSkips || typeof state.gossipPushSkips !== 'object') {
    state.gossipPushSkips = {};
  }
  const peerEntry = state.gossipPushSkips[peer] && typeof state.gossipPushSkips[peer] === 'object'
    ? state.gossipPushSkips[peer]
    : {};
  peerEntry[scope] = {
    status: cleanedStatus,
    reason: cleanedReason,
    untilMs,
    updatedAt: new Date(now).toISOString(),
  };
  state.gossipPushSkips[peer] = peerEntry;
  prunePushEndpointSkips(state, { now });
  return peerEntry[scope];
}

function clearPushEndpointSkip(state, peer, scope) {
  if (!peer || !PUSH_SKIP_SCOPES.includes(scope)) return;
  if (!state?.gossipPushSkips || typeof state.gossipPushSkips !== 'object') return;
  const peerEntry = state.gossipPushSkips[peer];
  if (!peerEntry || typeof peerEntry !== 'object') return;
  delete peerEntry[scope];
  if (!Object.keys(peerEntry).length) {
    delete state.gossipPushSkips[peer];
    return;
  }
  state.gossipPushSkips[peer] = peerEntry;
}

function prunePushEndpointSkips(state, { now = Date.now() } = {}) {
  if (!state.gossipPushSkips || typeof state.gossipPushSkips !== 'object') {
    state.gossipPushSkips = {};
    return state.gossipPushSkips;
  }
  const next = {};
  for (const [peer, scopes] of Object.entries(state.gossipPushSkips)) {
    if (!scopes || typeof scopes !== 'object') continue;
    const keep = {};
    for (const scope of PUSH_SKIP_SCOPES) {
      const entry = scopes[scope];
      const untilMs = Number(entry?.untilMs || 0);
      if (!entry || !Number.isFinite(untilMs) || untilMs <= now) continue;
      keep[scope] = {
        status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
        reason: String(entry.reason || '').trim().slice(0, 120) || null,
        untilMs,
        updatedAt: entry.updatedAt || new Date(now).toISOString(),
      };
    }
    if (Object.keys(keep).length) {
      next[peer] = keep;
    }
  }

  const peers = Object.entries(next);
  if (peers.length > PUSH_SKIP_MAX_PEERS) {
    peers.sort((a, b) => getPeerPushSkipUpdatedAtMs(b[1]) - getPeerPushSkipUpdatedAtMs(a[1]));
    const trimmed = peers.slice(0, PUSH_SKIP_MAX_PEERS);
    const reduced = {};
    for (const [peer, entry] of trimmed) {
      reduced[peer] = entry;
    }
    state.gossipPushSkips = reduced;
    return state.gossipPushSkips;
  }

  state.gossipPushSkips = next;
  return state.gossipPushSkips;
}

function getPeerPushSkipUpdatedAtMs(scopes = {}) {
  let latest = 0;
  for (const scope of PUSH_SKIP_SCOPES) {
    const value = Date.parse(scopes?.[scope]?.updatedAt || '');
    if (Number.isFinite(value) && value > latest) latest = value;
  }
  return latest;
}

function shouldBypassPushSkipCache(capabilities, scope) {
  const modules = capabilities?.modules;
  if (!modules || typeof modules !== 'object') return false;
  if (scope === 'ledger') {
    if (!Object.prototype.hasOwnProperty.call(modules, 'federation')) return false;
    const federationEnabled = modules.federation !== false;
    const replicationMode = capabilities?.replication?.mode;
    const gossipEnabled = !replicationMode || replicationMode !== 'centralized';
    return federationEnabled && gossipEnabled;
  }
  if (scope === 'votes' || scope === 'transactions') {
    return shouldBypassOptionalSkipCache(capabilities, scope);
  }
  return false;
}

function summarizeResults({
  peerResults,
  peers,
  reason,
  startedAt,
  finishedAt,
  votesPayload,
  transactionsPayload,
}) {
  const hasVotesPayload = Boolean(votesPayload);
  const hasTransactionsPayload = Boolean(transactionsPayload);
  const ledger = { sent: peers.length, ok: 0, failed: 0, added: 0, skipped: false };
  const votes = {
    sent: hasVotesPayload ? peers.length : 0,
    ok: 0,
    failed: 0,
    skipped: !hasVotesPayload,
    added: 0,
    updated: 0,
  };
  const transactions = {
    sent: hasTransactionsPayload ? peers.length : 0,
    ok: 0,
    failed: 0,
    skipped: !hasTransactionsPayload,
    added: 0,
    updated: 0,
  };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
      ledger.skipped = true;
    } else if (result.ledger?.ok) {
      ledger.ok += 1;
      if (Number.isFinite(result.ledger.added)) {
        ledger.added += result.ledger.added;
      }
    } else {
      ledger.failed += 1;
      errors.push(buildError(result, 'ledger'));
    }

    if (hasVotesPayload) {
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
    } else if (result.votes?.skipped) {
      votes.skipped = true;
    }

    if (hasTransactionsPayload) {
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
    } else if (result.transactions?.skipped) {
      transactions.skipped = true;
    }
  }

  const ok = errors.length === 0;
  const durationMs = computeDurationMs(startedAt, finishedAt);
  return {
    ok,
    reason,
    startedAt,
    finishedAt,
    durationMs,
    peers: peers.length,
    ledger,
    votes,
    transactions,
    errors,
  };
}

function summarizePullResults({ peerResults, peers, reason, startedAt, finishedAt }) {
  const ledger = { sent: peers.length, ok: 0, failed: 0, added: 0, skipped: false };
  const votes = { sent: peers.length, ok: 0, failed: 0, skipped: false, added: 0, updated: 0 };
  const transactions = { sent: peers.length, ok: 0, failed: 0, skipped: false, added: 0, updated: 0 };
  const errors = [];

  for (const result of peerResults) {
    if (result.ledger?.skipped) {
      ledger.sent -= 1;
      ledger.skipped = true;
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
  const durationMs = computeDurationMs(startedAt, finishedAt);
  return {
    ok,
    reason,
    startedAt,
    finishedAt,
    durationMs,
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
  const durationMs = computeDurationMs(startedAt, finishedAt);
  return {
    ok: false,
    reason,
    startedAt,
    finishedAt,
    durationMs,
    peers: 0,
    ledger: { sent: 0, ok: 0, failed: 0, added: 0, skipped: true },
    votes: { sent: 0, ok: 0, failed: 0, skipped: true, added: 0, updated: 0 },
    transactions: { sent: 0, ok: 0, failed: 0, skipped: true, added: 0, updated: 0 },
    errors: [],
    skipped: skip,
  };
}

function buildErrorSummary({ reason, startedAt, finishedAt, error, peers }) {
  const durationMs = computeDurationMs(startedAt, finishedAt);
  return {
    ok: false,
    reason,
    startedAt,
    finishedAt,
    durationMs,
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
  const localLedgerHash = computeLedgerHash([...state.uniquenessLedger]);
  for (const result of peerResults) {
    if (!result?.peer) continue;
    const outcome = classifyPeerOutcome(result);
    if (!outcome) continue;
    if (outcome.ok) {
      updated = recordPeerSuccess(state, result.peer).updated || updated;
    } else {
      updated = recordPeerFailure(state, result.peer, { reason: outcome.reason, penalty: 1 }).updated || updated;
    }
    const ledgerHash = result.ledger?.ledgerHash;
    const ledgerOk = result.ledger?.ok;
    if (ledgerHash && ledgerOk) {
      const ledgerUpdate = recordPeerLedger(state, result.peer, { ledgerHash, match: ledgerHash === localLedgerHash });
      updated = ledgerUpdate.updated || updated;
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

function computeDurationMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt || '');
  const finish = Date.parse(finishedAt || '');
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
  return Math.max(0, finish - start);
}

function resolveOptionalSkipTtlMs() {
  const seconds = Number(POLICIES.gossipOptionalSkipSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000;
}
