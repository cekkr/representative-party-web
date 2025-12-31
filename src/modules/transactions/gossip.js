import { getEffectivePolicy } from '../circle/policy.js';
import { decideStatus, getReplicationProfile } from '../federation/replication.js';
import { isPeerQuarantined, recordPeerFailure, recordPeerSuccess, resolvePeerKey } from '../federation/quarantine.js';
import { persistSettings, persistTransactionSummaries } from '../../infra/persistence/storage.js';
import { exportTransactionsEnvelope, verifyTransactionsEnvelope } from './registry.js';

const MAX_SUMMARIES = 200;
const MAX_ENTRY_DIGESTS = 120;

export function buildTransactionsPayload(state, { limit = 100 } = {}) {
  if (!state?.transactions || state.transactions.length === 0) return null;
  const envelope = exportTransactionsEnvelope(state, { limit });
  return envelope ? { envelope } : null;
}

export async function ingestTransactionsSummary({ state, envelope, peerHint, statusHint } = {}) {
  const peerKey = resolvePeerKey(peerHint, envelope?.issuer);
  const quarantine = isPeerQuarantined(state, peerKey);
  if (quarantine.quarantined) {
    if (quarantine.updated) await persistSettings(state);
    return {
      statusCode: 403,
      payload: { error: 'peer_quarantined', detail: 'Peer is quarantined for prior policy or signature failures.' },
    };
  }

  if (!envelope || typeof envelope !== 'object') {
    return { statusCode: 400, payload: { error: 'missing_envelope', detail: 'Transactions envelope required.' } };
  }

  const verification = verifyTransactionsEnvelope(envelope);
  if (verification && !verification.valid && !verification.skipped) {
    const updated = recordPeerFailure(state, peerKey, { reason: 'invalid_signature', penalty: 2 }).updated;
    if (updated) await persistSettings(state);
    return {
      statusCode: 400,
      payload: { error: 'invalid_signature', detail: 'Transactions envelope signature rejected.' },
    };
  }

  const policy = getEffectivePolicy(state);
  const policyCheck = validatePolicy(policy, envelope.policy);
  if (!policyCheck.ok) {
    const updated = recordPeerFailure(state, peerKey, { reason: policyCheck.error, penalty: 2 }).updated;
    if (updated) await persistSettings(state);
    return {
      statusCode: 409,
      payload: {
        error: policyCheck.error,
        detail: policyCheck.detail,
        expected: policyCheck.expected,
        received: policyCheck.received,
      },
    };
  }

  const profile = getReplicationProfile(state);
  const replicationStatus = decideStatus(profile, envelope.status || statusHint || 'validated');
  if (replicationStatus.status === 'rejected') {
    return {
      statusCode: 202,
      payload: {
        added: 0,
        total: (state.transactionSummaries || []).length,
        replication: { status: replicationStatus, profile },
        verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
        detail: 'Incoming payload marked as preview and previews are disabled.',
      },
    };
  }

  if (!envelope.summary || !envelope.issuer) {
    const updated = recordPeerFailure(state, peerKey, { reason: 'missing_fields' }).updated;
    if (updated) await persistSettings(state);
    return {
      statusCode: 400,
      payload: { error: 'missing_fields', detail: 'Transactions summary or issuer missing.' },
    };
  }

  const entries = Array.isArray(envelope.entries)
    ? envelope.entries.slice(0, MAX_ENTRY_DIGESTS).map(normalizeEntry).filter(Boolean)
    : [];
  const summaryKey = `${envelope.issuer}:${envelope.summary}`;
  const summaries = state.transactionSummaries || [];
  const existingIndex = summaries.findIndex((entry) => `${entry.issuer}:${entry.summary}` === summaryKey);

  const now = new Date().toISOString();
  const nextEntry = {
    id: envelope.id || `transactions-${Date.now()}`,
    issuer: envelope.issuer,
    issuedAt: envelope.issuedAt || now,
    summary: envelope.summary,
    entryCount: entries.length,
    entries,
    policy: envelope.policy || null,
    profile: envelope.profile || null,
    signature: envelope.signature || null,
    status: replicationStatus.status,
    validationStatus: replicationStatus.status,
    verification: verification ? { valid: verification.valid, skipped: verification.skipped } : undefined,
    peer: peerKey || null,
    receivedAt: now,
    provenance: {
      issuer: envelope.issuer,
      mode: envelope.profile?.mode || null,
      adapter: envelope.profile?.adapter || null,
    },
  };

  let added = 0;
  let updated = 0;
  const filtered = summaries.filter((entry) => `${entry.issuer}:${entry.summary}` !== summaryKey);
  if (existingIndex >= 0) {
    updated = 1;
  } else {
    added = 1;
  }

  state.transactionSummaries = [nextEntry, ...filtered].slice(0, MAX_SUMMARIES);
  if (added || updated) {
    await persistTransactionSummaries(state);
  }

  if (peerKey) {
    const updatedHealth = (added || updated)
      ? recordPeerSuccess(state, peerKey).updated
      : recordPeerSuccess(state, peerKey, { now: Date.now() }).updated;
    if (updatedHealth) await persistSettings(state);
  }

  return {
    statusCode: 200,
    payload: {
      added,
      updated,
      total: state.transactionSummaries.length,
      summary: envelope.summary,
      issuer: envelope.issuer,
      replication: { status: replicationStatus, profile },
      verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
    },
  };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const digest = typeof entry.digest === 'string' ? entry.digest : '';
  if (!digest) return null;
  return {
    id: entry.id || null,
    type: entry.type || 'unknown',
    petitionId: entry.petitionId || null,
    actorHash: entry.actorHash || null,
    digest,
    createdAt: entry.createdAt || null,
  };
}

function validatePolicy(localPolicy, envelopePolicy) {
  if (!envelopePolicy || !envelopePolicy.id) {
    return {
      ok: false,
      error: 'policy_missing',
      detail: 'Envelope policy id is missing.',
      expected: { id: localPolicy.id, version: localPolicy.version },
      received: envelopePolicy || null,
    };
  }
  if (envelopePolicy.id !== localPolicy.id) {
    return {
      ok: false,
      error: 'policy_mismatch',
      detail: 'Envelope policy id does not match.',
      expected: { id: localPolicy.id, version: localPolicy.version },
      received: envelopePolicy,
    };
  }
  if (Number(envelopePolicy.version) !== Number(localPolicy.version)) {
    return {
      ok: false,
      error: 'policy_version_mismatch',
      detail: 'Envelope policy version does not match.',
      expected: { id: localPolicy.id, version: localPolicy.version },
      received: envelopePolicy,
    };
  }
  return { ok: true };
}
