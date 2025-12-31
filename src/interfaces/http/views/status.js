import { describeProfile, filterVisibleEntries, getReplicationProfile } from '../../../modules/federation/replication.js';
import { getCirclePolicyState } from '../../../modules/circle/policy.js';

export function deriveStatusMeta(state) {
  const policy = getCirclePolicyState(state);
  const profile = getReplicationProfile(state);
  const ledgerCount = state?.uniquenessLedger?.size || 0;
  const actorCount = state?.actors?.size || 0;
  const discussionCount = filterVisibleEntries(state?.discussions || [], state).length;
  const policyStatus =
    policy.enforcement === 'strict'
      ? `Circle enforcement: strict · Verification ${policy.requireVerification ? 'required' : 'optional'}`
      : `Circle enforcement: observing · Verification ${policy.requireVerification ? 'recommended' : 'optional'}`;
  const accountabilityStatus = `Ledger ${ledgerCount} · Actors ${actorCount} · Discussions ${discussionCount}`;
  const validationStatus = `Validation: ${profile.validationLevel} (${profile.allowPreviews ? 'previews allowed' : 'previews hidden'})`;
  const previewStatus = `Data mode: ${describeProfile(profile)}`;

  return {
    accountabilityStatus,
    policyStatus,
    validationStatus,
    previewStatus,
  };
}

export function renderStatusStrip(meta = {}) {
  const { accountabilityStatus = '', policyStatus = '', validationStatus = '', previewStatus = '' } = meta;
  if (!accountabilityStatus && !policyStatus && !validationStatus && !previewStatus) return '';
  return `
    <div class="status-strip">
      ${accountabilityStatus ? `<span class="pill">${accountabilityStatus}</span>` : ''}
      ${policyStatus ? `<span class="pill ghost">${policyStatus}</span>` : ''}
      ${validationStatus ? `<span class="pill ghost">${validationStatus}</span>` : ''}
      ${previewStatus ? `<span class="pill ghost">${previewStatus}</span>` : ''}
    </div>
  `;
}
