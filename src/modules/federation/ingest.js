import { computeLedgerHash, verifyLedgerEnvelope } from '../circle/federation.js';
import { getEffectivePolicy } from '../circle/policy.js';
import { persistLedger, persistPeers, persistSettings, persistVotes } from '../../infra/persistence/storage.js';
import { verifyVoteEnvelope } from '../votes/voteEnvelope.js';
import { decideStatus, getReplicationProfile } from './replication.js';
import { normalizePeerUrl } from './peers.js';
import { isPeerQuarantined, recordPeerFailure, recordPeerSuccess, resolvePeerKey } from './quarantine.js';

export async function ingestLedgerGossip({ state, envelope, hashes, peerHint, statusHint } = {}) {
  const peerKey = resolvePeerKey(peerHint, envelope?.issuer);
  const quarantine = isPeerQuarantined(state, peerKey);
  if (quarantine.quarantined) {
    if (quarantine.updated) await persistSettings(state);
    return {
      statusCode: 403,
      payload: { error: 'peer_quarantined', detail: 'Peer is quarantined for prior policy or signature failures.' },
    };
  }
  const profile = getReplicationProfile(state);
  const replicationStatus = decideStatus(profile, envelope?.status || statusHint || 'validated');
  const verification = envelope ? verifyLedgerEnvelope(envelope) : null;
  const preLedgerHash = computeLedgerHash([...state.uniquenessLedger]);
  const policy = getEffectivePolicy(state);
  const policyCheck = envelope ? validatePolicy(policy, envelope.policy) : { ok: true };

  if (verification && !verification.valid && !verification.skipped) {
    const updated = recordPeerFailure(state, peerKey, { reason: 'invalid_signature', penalty: 2 }).updated;
    if (updated) await persistSettings(state);
    return {
      statusCode: 400,
      payload: { error: 'invalid_signature', detail: 'Ledger envelope signature rejected.' },
    };
  }

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

  if (replicationStatus.status === 'rejected') {
    return {
      statusCode: 202,
      payload: {
        added: 0,
        total: state.uniquenessLedger.size,
        peers: [...state.peers],
        ledgerHash: preLedgerHash,
        replication: { status: replicationStatus, profile },
        verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
        detail: 'Incoming payload marked as preview and previews are disabled.',
      },
    };
  }

  const entries = envelope
    ? Array.isArray(envelope.entries)
      ? envelope.entries
      : []
    : Array.isArray(hashes)
      ? hashes
      : [];
  if (envelope?.ledgerHash) {
    const expected = computeLedgerHash(entries);
    if (expected !== envelope.ledgerHash) {
      const updated = recordPeerFailure(state, peerKey, { reason: 'ledger_hash_mismatch', penalty: 2 }).updated;
      if (updated) await persistSettings(state);
      return {
        statusCode: 400,
        payload: {
          error: 'ledger_hash_mismatch',
          detail: 'Ledger digest did not match entry list.',
          ledgerHash: preLedgerHash,
        },
      };
    }
  }

  let added = 0;
  for (const hash of entries) {
    const normalized = String(hash);
    if (!state.uniquenessLedger.has(normalized)) {
      state.uniquenessLedger.add(normalized);
      added += 1;
    }
  }

  const hint = peerHint || envelope?.issuer;
  const normalizedPeer = normalizePeerUrl(hint);
  if (normalizedPeer && !state.peers.has(normalizedPeer)) {
    state.peers.add(normalizedPeer);
    await persistPeers(state);
  }
  if (added > 0) {
    await persistLedger(state);
  }

  if (peerKey) {
    const updated = recordPeerSuccess(state, peerKey).updated;
    if (updated) await persistSettings(state);
  }

  const localLedgerHash = computeLedgerHash([...state.uniquenessLedger]);
  return {
    statusCode: 200,
    payload: {
      added,
      total: state.uniquenessLedger.size,
      peers: [...state.peers],
      ledgerHash: localLedgerHash,
      replication: { status: replicationStatus, profile },
      verification: verification ? { skipped: verification.skipped, valid: verification.valid } : undefined,
    },
  };
}

export async function ingestVoteGossip({ state, envelopes = [], statusHint, peerHint } = {}) {
  const peerKey = resolvePeerKey(peerHint, envelopes?.[0]?.issuer);
  const quarantine = isPeerQuarantined(state, peerKey);
  if (quarantine.quarantined) {
    if (quarantine.updated) await persistSettings(state);
    return {
      statusCode: 403,
      added: 0,
      total: state.votes.length,
      error: 'peer_quarantined',
    };
  }
  const profile = getReplicationProfile(state);
  const policy = getEffectivePolicy(state);
  let added = 0;
  let rejected = 0;
  let hardFailure = false;
  const errors = [];

  for (const envelope of envelopes || []) {
    if (!envelope) continue;
    const verification = verifyVoteEnvelope(envelope);
    if (verification && !verification.valid && !verification.skipped) {
      hardFailure = true;
      rejected += 1;
      errors.push({ error: 'invalid_signature', petitionId: envelope.petitionId || null });
      continue;
    }
    const policyCheck = validatePolicy(policy, envelope.policy);
    if (!policyCheck.ok) {
      hardFailure = true;
      rejected += 1;
      errors.push({ error: policyCheck.error, petitionId: envelope.petitionId || null });
      continue;
    }
    const replicationStatus = decideStatus(profile, envelope?.status || statusHint || 'validated');
    if (replicationStatus.status === 'rejected') {
      rejected += 1;
      continue;
    }
    if (!envelope.petitionId || !envelope.authorHash) {
      hardFailure = true;
      rejected += 1;
      errors.push({ error: 'missing_fields', petitionId: envelope.petitionId || null });
      continue;
    }
    const voteKey = `${envelope.petitionId}:${envelope.authorHash}`;
    const exists = state.votes.some((vote) => `${vote.petitionId}:${vote.authorHash}` === voteKey);
    if (exists) continue;
    state.votes.push({
      petitionId: envelope.petitionId,
      authorHash: envelope.authorHash,
      choice: envelope.choice,
      createdAt: envelope.createdAt,
      validationStatus: replicationStatus.status,
      envelope: { ...envelope, status: replicationStatus.status },
    });
    added += 1;
  }

  if (peerKey) {
    if (hardFailure) {
      const updated = recordPeerFailure(state, peerKey, { reason: errors[0]?.error || 'invalid_vote' }).updated;
      if (updated) await persistSettings(state);
    } else if (added > 0) {
      const updated = recordPeerSuccess(state, peerKey).updated;
      if (updated) await persistSettings(state);
    }
  }

  if (added > 0) {
    await persistVotes(state);
  }
  return { statusCode: 200, added, rejected, total: state.votes.length, errors, profile };
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
