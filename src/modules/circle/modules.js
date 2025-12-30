const MODULE_DEFINITIONS = [
  {
    key: 'social',
    label: 'Social feed',
    description: 'Micro-posts, replies, mentions, reshares, typed follows.',
    defaultEnabled: true,
  },
  {
    key: 'petitions',
    label: 'Petitions & proposals',
    description: 'Drafts, signatures/quorum, discussion notes.',
    defaultEnabled: true,
  },
  {
    key: 'votes',
    label: 'Votes & envelopes',
    description: 'Vote casting, envelope export, ledger sync.',
    defaultEnabled: true,
    requires: ['petitions'],
  },
  {
    key: 'delegation',
    label: 'Delegation',
    description: 'Topic-scoped delegation and overrides.',
    defaultEnabled: true,
  },
  {
    key: 'groups',
    label: 'Groups & elections',
    description: 'Delegate cachets and group elections.',
    defaultEnabled: true,
    requires: ['delegation'],
  },
  {
    key: 'federation',
    label: 'Federation endpoints',
    description: 'Gossip endpoints and ActivityPub stubs.',
    defaultEnabled: true,
  },
  {
    key: 'topicGardener',
    label: 'Topic gardener helper',
    description: 'External topic classification helper.',
    defaultEnabled: true,
  },
];

export function listModuleDefinitions() {
  return MODULE_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getModuleDefinition(key) {
  return MODULE_DEFINITIONS.find((definition) => definition.key === key) || null;
}

export function getDefaultModuleSettings() {
  const defaults = {};
  for (const definition of MODULE_DEFINITIONS) {
    defaults[definition.key] = definition.defaultEnabled !== false;
  }
  return defaults;
}

export function normalizeModuleSettings(raw = {}) {
  const defaults = getDefaultModuleSettings();
  const normalized = {};
  for (const definition of MODULE_DEFINITIONS) {
    const value = raw[definition.key];
    normalized[definition.key] = typeof value === 'boolean' ? value : defaults[definition.key];
  }
  return applyDependencies(normalized);
}

export function resolveModuleSettings(state) {
  const settings = state?.settings?.modules || {};
  return normalizeModuleSettings(settings);
}

export function isModuleEnabled(state, key) {
  const resolved = resolveModuleSettings(state);
  if (Object.prototype.hasOwnProperty.call(resolved, key)) {
    return Boolean(resolved[key]);
  }
  return true;
}

export function listModuleToggles(state) {
  const resolved = resolveModuleSettings(state);
  return MODULE_DEFINITIONS.map((definition) => ({
    ...definition,
    enabled: Boolean(resolved[definition.key]),
  }));
}

function applyDependencies(settings = {}) {
  const resolved = { ...settings };
  for (const definition of MODULE_DEFINITIONS) {
    const requires = definition.requires || [];
    if (!requires.length) continue;
    const blocked = requires.some((dependency) => resolved[dependency] === false);
    if (blocked) {
      resolved[definition.key] = false;
    }
  }
  return resolved;
}
