import { computeLedgerHash, verifyLedgerEnvelope } from '../circle/federation.js';
import { persistLedger, persistPeers, persistVotes } from '../../infra/persistence/storage.js';
import { verifyVoteEnvelope } from '../votes/voteEnvelope.js';
import { decideStatus, getReplicationProfile } from './replication.js';
import { normalizePeerUrl } from './peers.js';

export async function ingestLedgerGossip({ state, envelope, hashes, peerHint, statusHint } = {}) {
  const profile = getReplicationProfile(state);
  const replicationStatus = decideStatus(profile, envelope?.status || statusHint || 'validated');
  const verification = envelope ? verifyLedgerEnvelope(envelope) : null;
  const preLedgerHash = computeLedgerHash([...state.uniquenessLedger]);

  if (verification && !verification.valid && !verification.skipped) {
    return {
      statusCode: 400,
      payload: { error: 'invalid_signature', detail: 'Ledger envelope signature rejected.' },
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

export async function ingestVoteGossip({ state, envelopes = [], statusHint } = {}) {
  const profile = getReplicationProfile(state);
  let added = 0;

  for (const envelope of envelopes || []) {
    if (!envelope) continue;
    const verification = verifyVoteEnvelope(envelope);
    if (verification && !verification.valid && !verification.skipped) {
      continue;
    }
    const replicationStatus = decideStatus(profile, envelope?.status || statusHint || 'validated');
    if (replicationStatus.status === 'rejected') {
      continue;
    }
    if (!envelope.petitionId || !envelope.authorHash) {
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

  if (added > 0) {
    await persistVotes(state);
  }
  return { added, total: state.votes.length, profile };
}
