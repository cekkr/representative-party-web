import { getEffectivePolicy } from '../../../modules/circle/policy.js';

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

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}
