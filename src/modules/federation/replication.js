import { DATA } from '../../config.js';

export function getReplicationProfile(state) {
  const config = state?.dataConfig || {};
  return {
    mode: config.mode || DATA.mode,
    adapter: config.adapter || DATA.adapter,
    validationLevel: config.validationLevel || DATA.validationLevel,
    allowPreviews: config.allowPreviews ?? DATA.allowPreviews,
  };
}

export function shouldAcceptPreviews(profile) {
  if (!profile) return true;
  if (profile.validationLevel === 'strict') return Boolean(profile.allowPreviews);
  return true;
}

export function decideStatus(profile, hintedStatus = 'validated') {
  const normalizedHint = hintedStatus === 'preview' ? 'preview' : 'validated';
  const allowPreview = shouldAcceptPreviews(profile);
  if (normalizedHint === 'preview' && !allowPreview) {
    return { status: 'rejected', reason: 'preview_blocked', allowPreview };
  }
  if (profile.validationLevel === 'off') {
    return { status: 'validated', allowPreview };
  }
  if (profile.validationLevel === 'observe' && normalizedHint === 'preview') {
    return { status: 'preview', allowPreview };
  }
  return { status: normalizedHint, allowPreview };
}

export function describeProfile(profile) {
  const mode = profile?.mode || DATA.mode;
  const adapter = profile?.adapter || DATA.adapter;
  const validation = profile?.validationLevel || DATA.validationLevel;
  const preview = profile?.allowPreviews ?? DATA.allowPreviews;
  return `${mode}/${adapter} (${validation}${preview ? ', previews on' : ''})`;
}
