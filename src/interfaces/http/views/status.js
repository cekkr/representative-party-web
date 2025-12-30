import { describeProfile, getReplicationProfile } from '../../../modules/federation/replication.js';
import { getCirclePolicyState } from '../../../modules/circle/policy.js';

export function deriveStatusMeta(state) {
  const policy = getCirclePolicyState(state);
  const profile = getReplicationProfile(state);
  const policyStatus =
    policy.enforcement === 'strict'
      ? `Circle enforcement: strict · Verification ${policy.requireVerification ? 'required' : 'optional'}`
      : `Circle enforcement: observing · Verification ${policy.requireVerification ? 'recommended' : 'optional'}`;
  const validationStatus = `Validation: ${profile.validationLevel} (${profile.allowPreviews ? 'previews allowed' : 'previews hidden'})`;
  const previewStatus = `Data mode: ${describeProfile(profile)}`;

  return {
    policyStatus,
    validationStatus,
    previewStatus,
  };
}

export function renderStatusStrip(meta = {}) {
  const { policyStatus = '', validationStatus = '', previewStatus = '' } = meta;
  if (!policyStatus && !validationStatus && !previewStatus) return '';
  return `
    <div class="status-strip">
      ${policyStatus ? `<span class="pill ghost">${policyStatus}</span>` : ''}
      ${validationStatus ? `<span class="pill ghost">${validationStatus}</span>` : ''}
      ${previewStatus ? `<span class="pill ghost">${previewStatus}</span>` : ''}
    </div>
  `;
}
