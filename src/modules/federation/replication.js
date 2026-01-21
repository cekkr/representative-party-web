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
  if (!profile) return DATA.allowPreviews;
  if (typeof profile.allowPreviews === 'boolean') return profile.allowPreviews;
  return DATA.allowPreviews;
}

export function decideStatus(profile, hintedStatus = 'validated') {
  const normalizedHint = hintedStatus === 'preview' ? 'preview' : 'validated';
  const allowPreview = shouldAcceptPreviews(profile);
  const validationLevel = profile?.validationLevel || DATA.validationLevel;
  if (normalizedHint === 'preview' && !allowPreview) {
    return { status: 'rejected', reason: 'preview_blocked', allowPreview };
  }
  if (validationLevel === 'off') {
    return { status: 'validated', allowPreview };
  }
  if (validationLevel === 'observe' && normalizedHint === 'preview') {
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

export function filterVisibleEntries(list, state, predicate) {
  const profile = getReplicationProfile(state);
  const entries = list || [];
  const hasPredicate = typeof predicate === 'function';
  if (profile.allowPreviews) {
    return hasPredicate ? entries.filter(predicate) : entries;
  }
  if (!hasPredicate) {
    return entries.filter((item) => (item?.validationStatus || 'validated') !== 'preview');
  }
  const filtered = [];
  for (const item of entries) {
    if ((item?.validationStatus || 'validated') === 'preview') continue;
    if (!predicate(item)) continue;
    filtered.push(item);
  }
  return filtered;
}

export function countVisibleEntries(list, state, predicate) {
  const profile = getReplicationProfile(state);
  const entries = list || [];
  const hasPredicate = typeof predicate === 'function';
  if (profile.allowPreviews && !hasPredicate) return entries.length || 0;
  let count = 0;
  for (const item of entries) {
    if (!profile.allowPreviews && (item?.validationStatus || 'validated') === 'preview') continue;
    if (hasPredicate && !predicate(item)) continue;
    count += 1;
  }
  return count;
}

export function someVisibleEntries(list, state, predicate) {
  const profile = getReplicationProfile(state);
  const entries = list || [];
  const hasPredicate = typeof predicate === 'function';
  for (const item of entries) {
    if (!profile.allowPreviews && (item?.validationStatus || 'validated') === 'preview') continue;
    if (hasPredicate && !predicate(item)) continue;
    return true;
  }
  return false;
}

export function findVisibleEntry(list, state, predicate) {
  const profile = getReplicationProfile(state);
  const entries = list || [];
  const hasPredicate = typeof predicate === 'function';
  for (const item of entries) {
    if (!profile.allowPreviews && (item?.validationStatus || 'validated') === 'preview') continue;
    if (hasPredicate && !predicate(item)) continue;
    return item;
  }
  return undefined;
}
