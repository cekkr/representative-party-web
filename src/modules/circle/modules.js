const MODULE_FAMILY_DEFINITIONS = [
  {
    key: 'organizationOperations',
    label: 'Organization operations',
    description: 'Communication-first coordination with optional responsibility, authority, resource, hierarchy, and sector layers.',
  },
  {
    key: 'socialP2P',
    label: 'P2P social/community',
    description: 'Reusable social networking and community coordination modules.',
  },
  {
    key: 'partyGovernance',
    label: 'Civic governance',
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
    key: 'coordination',
    label: 'Coordination workspace',
    description: 'Open cases from attributed discussion posts, record acknowledgements and review dates, and search the case queue.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Case workspace', href: '/organization' }],
    defaultEnabled: true,
  },
  {
    key: 'responsibilities',
    label: 'Responsibilities',
    description: 'Outcome ownership, commitments, contributors, and hand-off visibility.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Responsibilities layer', href: '/organization?view=preview#pressure-layer-responsibilities' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'protectedVoice',
    label: 'Protected voice',
    description: 'Attributed, role-visible, department-visible, and protected intake modes with retaliation safeguards.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Protection layer', href: '/organization?view=preview#pressure-layer-protection' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'hierarchies',
    label: 'Hierarchies & escalation',
    description: 'Contextual reporting paths, escalation routes, and temporary operating structures.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Structure layer', href: '/organization?view=preview#pressure-layer-hierarchies' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'authority',
    label: 'Authority & powers',
    description: 'Explicit propose, approve, veto, execute, and observe rights with scope and expiry.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Authority layer', href: '/organization?view=preview#pressure-layer-authority' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'funds',
    label: 'Funds & resources',
    description: 'Budget exposure, spending ceilings, approvals, evidence, and reconciliation cues.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Funds layer', href: '/organization?view=preview#pressure-layer-funds' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'sectors',
    label: 'Sectors & domains',
    description: 'Cross-functional scopes, dependencies, and impact views without duplicating the case.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Sectors layer', href: '/organization?view=preview#pressure-layer-sectors' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'mediation',
    label: 'Mediation & pacification',
    description: 'Protected acknowledgement, review, dialogue, agreement, and principled escalation paths.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Mediation layer', href: '/organization?view=preview#pressure-layer-mediation' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'pressureAnalytics',
    label: 'Pressure dynamics',
    description: 'Aggregate volume, velocity, persistence, spread, clustering, and organizational mirror views.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Pressure map', href: '/organization?view=preview#pressure-map' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
  {
    key: 'impactTracking',
    label: 'Impact tracking',
    description: 'Baselines, interventions, outcomes, learning notes, and repeat-pressure checks.',
    family: 'organizationOperations',
    settingsLinks: [{ label: 'Impact layer', href: '/organization?view=preview#pressure-layer-impact' }],
    defaultEnabled: false,
    requires: ['coordination'],
  },
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
