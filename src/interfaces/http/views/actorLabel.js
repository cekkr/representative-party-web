import { getEffectivePolicy, resolveDefaultActorRole } from '../../../modules/circle/policy.js';
import { findSessionByHash } from '../../../modules/identity/sessions.js';
import { escapeHtml } from '../../../shared/utils/text.js';

export function getActorLabels(state) {
  const policy = getEffectivePolicy(state || { settings: {} });
  const actorLabel = policy.enforceCircle ? 'person' : 'user';
  const actorLabelPlural = actorLabel === 'person' ? 'people' : 'users';
  return {
    actorLabel,
    actorLabelPlural,
    actorLabelTitle: capitalize(actorLabel),
    actorLabelPluralTitle: capitalize(actorLabelPlural),
  };
}

export function getActorLabel(state, { plural = false, title = false } = {}) {
  const labels = getActorLabels(state);
  if (plural && title) return labels.actorLabelPluralTitle;
  if (plural) return labels.actorLabelPlural;
  if (title) return labels.actorLabelTitle;
  return labels.actorLabel;
}

export function resolvePersonHandle(person, fallback = 'Guest session') {
  if (person?.handle) return person.handle;
  return fallback;
}

// Resolve a display handle for any pid hash. Uses the person's chosen handle when set,
// otherwise synthesizes the same role-prefixed fallback that getPerson() shows for the
// current session, so labels stay consistent whether or not a handle was picked.
export function resolveHandleForHash(state, hash) {
  if (!hash || hash === 'anonymous') return hash === 'anonymous' ? 'anonymous' : '';
  const session = findSessionByHash(state, hash);
  if (session?.handle) return session.handle;
  const role = session?.role || resolveDefaultActorRole(state || { settings: {} });
  const prefix = role === 'user' || role === 'person' ? role : 'user';
  return `${prefix}-${String(hash).slice(0, 8)}`;
}

// HTML label for an actor hash: "@handle" with the short hash kept as a secondary cue
// (full hash in the title) so identity stays legible without losing auditability.
export function renderActorLabel(state, hash, { tag = true, showHash = true } = {}) {
  if (!hash || hash === 'anonymous') {
    return '<span class="muted">anonymous</span>';
  }
  const handle = resolveHandleForHash(state, hash);
  const display = tag ? `@${handle}` : handle;
  const fullHash = escapeHtml(String(hash));
  const hashCue = showHash
    ? ` <span class="muted tiny" title="${fullHash}">${escapeHtml(String(hash).slice(0, 8))}…</span>`
    : '';
  return `<span class="actor" title="${fullHash}">${escapeHtml(display)}</span>${hashCue}`;
}

// A small identity avatar: a coloured disc with the handle's initial. The hue is
// derived deterministically from the actor hash so a person keeps a stable colour
// across the feed, giving discussion/forum/social the identity affordance a real
// social product has, without storing or inventing any avatar image.
export function renderActorAvatar(state, hash, { size = 'md' } = {}) {
  const handle = resolveHandleForHash(state, hash) || '';
  const clean = String(handle).replace(/^@/, '');
  const initial = (clean.charAt(0) || '?').toUpperCase();
  const src = String(hash || handle || '');
  let hue = 0;
  for (let i = 0; i < src.length; i += 1) {
    hue = (hue * 31 + src.charCodeAt(i)) % 360;
  }
  return `<span class="avatar avatar--${size}" style="--avatar-hue:${hue}" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
