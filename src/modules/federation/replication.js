import { DATA, ISSUER } from '../../config.js';

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
  const gossip = mode === 'centralized' ? ', gossip off' : '';
  return `${mode}/${adapter} (${validation}${preview ? ', previews on' : ''}${gossip})`;
}

export function isGossipEnabled(profile) {
  const mode = profile?.mode || DATA.mode;
  return mode !== 'centralized';
}

export function stampLocalEntry(state, entry = {}) {
  const profile = getReplicationProfile(state);
  const now = new Date().toISOString();
  const issuer = state?.issuer || state?.settings?.issuer || ISSUER;
  return {
    validationStatus: 'validated',
    mode: profile.mode,
    adapter: profile.adapter,
    issuer,
    provenance: {
      issuer,
      mode: profile.mode,
      adapter: profile.adapter,
    },
    validatedAt: entry.validationStatus === 'preview' ? null : now,
    validatedBy: entry.validationStatus === 'preview' ? null : issuer,
    ...entry,
  };
}

export function filterVisibleEntries(list, state) {
  const profile = getReplicationProfile(state);
  if (profile.allowPreviews) return list || [];
  return (list || []).filter((item) => (item?.validationStatus || 'validated') !== 'preview');
}

export function countVisibleEntries(list, state) {
  const profile = getReplicationProfile(state);
  const entries = list || [];
  if (profile.allowPreviews) return entries.length || 0;
  let count = 0;
  for (const item of entries) {
    if ((item?.validationStatus || 'validated') !== 'preview') {
      count += 1;
    }
  }
  return count;
}
