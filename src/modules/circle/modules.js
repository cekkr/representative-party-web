const MODULE_FAMILY_DEFINITIONS = [
  {
    key: 'socialP2P',
    label: 'P2P social/community',
    description: 'Reusable social networking and community coordination modules.',
  },
  {
    key: 'partyGovernance',
    label: 'E-party governance',
    description: 'Deliberation-to-decision modules for proposals, delegation, and voting.',
  },
  {
    key: 'federationResilience',
    label: 'Federation and resilience',
    description: 'Cross-provider sync, gossip, and audit-oriented transport controls.',
  },
];

const MODULE_DEFINITIONS = [
  {
    key: 'social',
    label: 'Social feed',
    description: 'Micro-posts, replies, mentions, reshares, typed follows.',
    family: 'socialP2P',
    settingsLinks: [{ label: 'Media moderation', href: '#social-media' }],
    defaultEnabled: true,
  },
  {
    key: 'petitions',
    label: 'Petitions & proposals',
    description: 'Drafts, signatures/quorum, discussion notes.',
    family: 'partyGovernance',
    settingsLinks: [
      { label: 'Circle defaults', href: '#wizard-step-3' },
      { label: 'Governance defaults', href: '#governance-settings' },
    ],
    defaultEnabled: true,
  },
  {
    key: 'votes',
    label: 'Votes & envelopes',
    description: 'Vote casting, envelope export, ledger sync.',
    family: 'partyGovernance',
    settingsLinks: [
      { label: 'Governance defaults', href: '#governance-settings' },
      { label: 'Gossip sync', href: '#federation-gossip' },
    ],
    defaultEnabled: true,
    requires: ['petitions'],
  },
  {
    key: 'delegation',
    label: 'Delegation',
    description: 'Topic-scoped delegation and overrides.',
    family: 'partyGovernance',
    settingsLinks: [{ label: 'Group defaults', href: '#wizard-step-3' }],
    defaultEnabled: true,
  },
  {
    key: 'groups',
    label: 'Groups & elections',
    description: 'Delegate cachets and group elections.',
    family: 'partyGovernance',
    settingsLinks: [{ label: 'Group defaults', href: '#wizard-step-3' }],
    defaultEnabled: true,
    requires: ['delegation'],
  },
  {
    key: 'federation',
    label: 'Federation endpoints',
    description: 'Gossip endpoints and ActivityPub stubs.',
    family: 'federationResilience',
    settingsLinks: [
      { label: 'Data and validation', href: '#wizard-step-1' },
      { label: 'Issuer and peers', href: '#wizard-step-2' },
      { label: 'Gossip sync', href: '#federation-gossip' },
      { label: 'Provider-blind mode', href: '#provider-blind' },
    ],
    defaultEnabled: true,
  },
  {
    key: 'topicGardener',
    label: 'Topic gardener helper',
    description: 'External topic classification helper.',
    family: 'socialP2P',
    settingsLinks: [
      { label: 'Anchors and pins', href: '#wizard-step-3' },
      { label: 'Review queue', href: '#topic-gardener-review' },
    ],
    defaultEnabled: true,
  },
];

export function listModuleDefinitions() {
  return MODULE_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function listModuleFamilyDefinitions() {
  return MODULE_FAMILY_DEFINITIONS.map((family) => ({ ...family }));
}

export function getModuleFamilyDefinition(key) {
  return MODULE_FAMILY_DEFINITIONS.find((family) => family.key === key) || null;
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
