import {
  countVisibleEntries,
  describeProfile,
  getReplicationProfile,
  isGossipEnabled,
} from '../../../modules/federation/replication.js';
import { getCirclePolicyState } from '../../../modules/circle/policy.js';

/**
 * Verification wording for a Circle policy. Verification is only "required"
 * when enforcement is strict; under observing enforcement it is a
 * recommendation, and saying "required" there contradicts what the gates
 * actually do. Shared so every surface uses the same word for the same setting.
 */
export function describeVerificationPolicy(policy = {}) {
  if (!policy.requireVerification) return 'Verification optional';
  return policy.enforcement === 'strict' ? 'Verification required' : 'Verification recommended';
}

export function deriveStatusMeta(state) {
  const policy = getCirclePolicyState(state);
  const profile = getReplicationProfile(state);
  const ledgerCount = state?.uniquenessLedger?.size || 0;
  const actorCount = state?.actors?.size || 0;
  const discussionCount = countVisibleEntries(state?.discussions || [], state);
  const enforcementLabel = policy.enforcement === 'strict' ? 'strict' : 'observing';
  const policyStatus = `Circle enforcement: ${enforcementLabel} - ${describeVerificationPolicy(policy)}`;
  const accountabilityStatus = `Ledger ${ledgerCount} - Actors ${actorCount} - Discussions ${discussionCount}`;
  const gossipStatus = `Gossip ingest: ${isGossipEnabled(profile) ? 'on' : 'off'}`;
  const validationStatus = `Validation: ${profile.validationLevel} (${profile.allowPreviews ? 'previews allowed' : 'previews hidden'})`;
  const previewStatus = `Data mode: ${describeProfile(profile)}`;

  return {
    accountabilityStatus,
    gossipStatus,
    policyStatus,
    validationStatus,
    previewStatus,
  };
}

export function renderStatusStrip(meta = {}, actorLabel = '') {
  const {
    accountabilityStatus = '',
    gossipStatus = '',
    policyStatus = '',
    validationStatus = '',
    previewStatus = '',
  } = meta;
  if (!accountabilityStatus && !gossipStatus && !policyStatus && !validationStatus && !previewStatus && !actorLabel) return '';
  return `
    <div class="status-strip">
      ${actorLabel ? `<span class="pill ghost">${actorLabel}</span>` : ''}
      ${accountabilityStatus ? `<span class="pill">${accountabilityStatus}</span>` : ''}
      ${gossipStatus ? `<span class="pill">${gossipStatus}</span>` : ''}
      ${policyStatus ? `<span class="pill ghost">${policyStatus}</span>` : ''}
      ${validationStatus ? `<span class="pill ghost">${validationStatus}</span>` : ''}
      ${previewStatus ? `<span class="pill ghost">${previewStatus}</span>` : ''}
    </div>
  `;
}
