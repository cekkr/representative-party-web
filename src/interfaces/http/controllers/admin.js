import { DATA_DEFAULTS, POLICIES, normalizeDataAdapter, normalizeDataMode, normalizeValidationLevel } from '../../../config.js';
import { computeLedgerHash } from '../../../modules/circle/federation.js';
import { DEFAULT_TOPIC_ANCHORS } from '../../../modules/topics/topicGardenerClient.js';
import {
  persistPeers,
  persistProfileAttributes,
  persistProfileStructures,
  persistSessions,
  persistSettings,
} from '../../../infra/persistence/storage.js';
import {
  evaluateAction,
  getCirclePolicyState,
  getEffectivePolicy,
  resolveDefaultActorRole,
} from '../../../modules/circle/policy.js';
import { isModuleEnabled, listModuleDefinitions, listModuleToggles, normalizeModuleSettings } from '../../../modules/circle/modules.js';
import { listAvailableExtensions } from '../../../modules/extensions/registry.js';
import { pullGossipNow, pushGossipNow } from '../../../modules/federation/gossip.js';
import { normalizePeerUrl } from '../../../modules/federation/peers.js';
import { clearPeerHealth, listPeerHealth, resetPeerHealth } from '../../../modules/federation/quarantine.js';
import {
  describeProfile,
  filterVisibleEntries,
  getReplicationProfile,
  isGossipEnabled,
} from '../../../modules/federation/replication.js';
import { DEFAULT_RATE_LIMITS, normalizeLimit } from '../../../modules/identity/rateLimit.js';
import { listTransactions } from '../../../modules/transactions/registry.js';
import {
  describeCanonicalProfile,
  formatProviderFieldsForTextarea,
  normalizeProviderFields,
  parseAttributePayloadWithValidation,
  parseProviderFieldInput,
  upsertProviderAttributes,
} from '../../../modules/structure/structureManager.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';

export async function renderAdmin({ req, res, state, wantsPartial }) {
  const availableExtensions = await listAvailableExtensions(state);
  const html = await renderPage(
    'admin',
    buildAdminViewModel(state, { flash: null, availableExtensions }),
    { wantsPartial, title: 'Admin · Circle Settings', state },
  );
  return sendHtml(res, html);
}

export function exportAuditLog({ res, state }) {
  const entries = (state.settings?.auditLog || []).slice(-50);
  return sendJson(res, 200, { auditLog: entries });
}

export async function updateAdmin({ req, res, state, wantsPartial }) {
  const body = await readRequestBody(req);
  const intent = body.intent || 'settings';
  if (intent === 'session') {
    const result = await updateSession(state, body);
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { ...result, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'structure') {
    const result = await updateStructure(state, body);
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { ...result, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'profile-attributes') {
    const result = await updateProfileAttributes(state, body);
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { ...result, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'modules') {
    const result = await updateModules(state, body);
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { ...result, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'rate-limits') {
    const result = await updateRateLimits(state, body);
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { ...result, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'gossip-push') {
    const summary = await pushGossipNow(state, { reason: 'admin' });
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { flash: formatGossipFlash(summary), availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'gossip-pull') {
    const summary = await pullGossipNow(state, { reason: 'admin' });
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { flash: formatGossipFlash(summary), availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }
  if (intent === 'peer-health-reset') {
    const resetAll = parseBoolean(body.resetAll, false);
    const peerKey = sanitizeText(body.peerKey || '', 200);
    const result = resetAll ? clearPeerHealth(state) : resetPeerHealth(state, peerKey);
    let flash = 'Peer health reset skipped.';
    if (result.updated) {
      const summary = resetAll ? 'all peers' : `peer=${result.removed}`;
      recordAdminAudit(state, { action: 'peer.health.reset', summary });
      await persistSettings(state);
      flash = resetAll ? 'Peer health reset for all peers.' : `Peer health reset for ${result.removed}.`;
    }
    const availableExtensions = await listAvailableExtensions(state);
    const html = await renderPage(
      'admin',
      buildAdminViewModel(state, { flash, availableExtensions }),
      { wantsPartial, title: 'Admin · Circle Settings', state },
    );
    return sendHtml(res, html);
  }

  const prev = state.settings || {};
  const enforceCircle = parseBoolean(body.enforceCircle, false);
  const requireVerification = parseBoolean(body.requireVerification, false);
  const newPeerRaw = sanitizeText(body.peerJoin || '', 200);
  const preferredPeerRaw = sanitizeText(body.preferredPeer || prev.preferredPeer || '', 200);
  const newPeer = normalizePeerUrl(newPeerRaw);
  const preferredPeerNormalized = normalizePeerUrl(preferredPeerRaw);
  const preferredPeer = preferredPeerNormalized || preferredPeerRaw;
  const defaultElectionMode = sanitizeText(body.defaultElectionMode || prev.groupPolicy?.electionMode || 'priority', 32);
  const defaultConflictRule = sanitizeText(body.defaultConflictRule || prev.groupPolicy?.conflictRule || 'highest_priority', 32);
  const petitionQuorumAdvance = normalizeQuorumAdvance(body.petitionQuorumAdvance || prev.petitionQuorumAdvance || 'discussion');
  const topicGardenerUrl = sanitizeText(body.topicGardenerUrl || prev.topicGardener?.url || '', 240);
  const topicAnchors = parseList(body.topicAnchors, prev.topicGardener?.anchors || DEFAULT_TOPIC_ANCHORS);
  const topicPinned = parseList(body.topicPinned, prev.topicGardener?.pinned || []);
  const modules = normalizeModuleSettings(prev.modules || {});
  const dataMode = normalizeDataMode(body.dataMode || prev.data?.mode || DATA_DEFAULTS.mode);
  const dataAdapter = normalizeDataAdapter(body.dataAdapter || prev.data?.adapter || DATA_DEFAULTS.adapter);
  const dataValidation = normalizeValidationLevel(body.dataValidation || prev.data?.validationLevel || DATA_DEFAULTS.validationLevel);
  const dataPreview = parseBoolean(body.dataPreview, prev.data?.allowPreviews ?? DATA_DEFAULTS.allowPreviews);

  state.settings = {
    ...prev,
    initialized: true,
    circleName: sanitizeText(body.circleName || prev.circleName || 'Party Circle', 80),
    policyId: sanitizeText(body.policyId || prev.policyId || POLICIES.id, 64) || POLICIES.id,
    enforceCircle,
    requireVerification,
    adminContact: sanitizeText(body.adminContact || prev.adminContact || '', 120),
    preferredPeer,
    notes: sanitizeText(body.notes || prev.notes || '', 400),
    petitionQuorumAdvance,
    groupPolicy: {
      electionMode: defaultElectionMode,
      conflictRule: defaultConflictRule,
    },
    topicGardener: {
      url: topicGardenerUrl,
      anchors: topicAnchors.length ? topicAnchors : DEFAULT_TOPIC_ANCHORS,
      pinned: topicPinned,
    },
    modules,
    data: {
      mode: dataMode,
      adapter: dataAdapter,
      validationLevel: dataValidation,
      allowPreviews: dataPreview,
    },
  };
  state.dataConfig = state.settings.data;

  let peersAdded = 0;
  const peersToAdd = Array.from(new Set([newPeer, preferredPeerNormalized].filter(Boolean)));
  for (const peer of peersToAdd) {
    if (!state.peers.has(peer)) {
      state.peers.add(peer);
      peersAdded += 1;
    }
  }
  if (peersAdded > 0) {
    await persistPeers(state);
  }

  await persistSettings(state);

  const flashParts = ['Settings saved'];
  if (peersAdded > 0) {
    flashParts.push(`Added peer(s) "${peersToAdd.join(', ')}" to Circle registry.`);
  }
  if (enforceCircle) {
    flashParts.push('Circle enforcement enabled.');
  }
  if (requireVerification) {
    flashParts.push('Wallet verification required for posting.');
  }

  const availableExtensions = await listAvailableExtensions(state);
  const html = await renderPage('admin', buildAdminViewModel(state, { flash: flashParts.join(' '), availableExtensions }), {
    wantsPartial,
    title: 'Admin · Circle Settings',
    state,
  });
  return sendHtml(res, html);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
}

function parseList(value, fallback = []) {
  if (Array.isArray(value)) {
    const cleaned = value.map((entry) => sanitizeText(entry, 64)).filter(Boolean);
    return cleaned.length ? dedupe(cleaned) : dedupe(fallback);
  }
  if (value === undefined || value === null || value === '') {
    return dedupe(fallback);
  }
  const parts = String(value)
    .split(',')
    .map((entry) => sanitizeText(entry, 64))
    .filter(Boolean);
  return parts.length ? dedupe(parts) : dedupe(fallback);
}

function dedupe(list) {
  return [...new Set(list || [])];
}

async function updateSession(state, body) {
  const sessionId = sanitizeText(body.sessionId || '', 72);
  const defaultRole = resolveDefaultActorRole(state);
  const role = sanitizeText(body.sessionRole || defaultRole, 32) || defaultRole;
  const banned = parseBoolean(body.sessionBanned, false);
  const handle = sanitizeText(body.sessionHandle || '', 64);
  if (!sessionId) {
    return { flash: 'Session ID required to update roles.', sessionForm: { sessionRole: role, sessionId, sessionHandle: handle, banned } };
  }
  const session = state.sessions.get(sessionId);
  if (!session) {
    return { flash: `Session "${sessionId}" not found.`, sessionForm: { sessionRole: role, sessionId, sessionHandle: handle, banned } };
  }

  const next = {
    ...session,
    role: role || session.role || 'person',
    banned,
  };
  if (handle) {
    next.handle = handle;
  }
  state.sessions.set(sessionId, next);
  await persistSessions(state);
  return {
    flash: `Session "${sessionId}" updated (${next.role}${next.banned ? ', banned' : ''}).`,
    sessionForm: { sessionRole: role, sessionId, sessionHandle: next.handle, banned },
  };
}

async function updateStructure(state, body) {
  const { fields, errors } = parseProviderFieldInput(body.providerFields || '');
  const normalized = normalizeProviderFields(fields);
  state.profileStructures = normalized;
  await persistProfileStructures(state);
  recordAdminAudit(state, {
    action: 'structure.update',
    summary: `fields=${normalized.length}${errors.length ? ` errors=${errors.length}` : ''}`,
  });
  await persistSettings(state);
  const flashParts = [];
  if (normalized.length) {
    flashParts.push(`Provider-local schema saved (${normalized.length} field${normalized.length === 1 ? '' : 's'}).`);
  } else {
    flashParts.push('Provider-local schema cleared.');
  }
  if (errors.length) {
    flashParts.push(`Validation: ${errors.join(' ')}`);
  }
  return {
    flash: flashParts.join(' '),
    providerFieldsValue: formatProviderFieldsForTextarea(normalized),
  };
}

async function updateProfileAttributes(state, body) {
  const sessionId = sanitizeText(body.attributesSessionId || '', 72);
  const payload = body.attributesPayload || '';
  if (!sessionId) {
    return { flash: 'Session ID required to persist profile attributes.', attributesPayloadValue: payload };
  }
  const session = state.sessions.get(sessionId);
  if (!session) {
    return { flash: `Session "${sessionId}" not found.`, attributesSessionId: sessionId, attributesPayloadValue: payload };
  }
  const providerFields = normalizeProviderFields(state.profileStructures || []);
  const { attributes, errors } = parseAttributePayloadWithValidation(payload, providerFields);
  state.profileStructures = providerFields;
  const replace = Object.keys(attributes).length === 0;
  const entry = upsertProviderAttributes(state, { sessionId, handle: session.handle, attributes, replace });
  await persistProfileStructures(state);
  await persistProfileAttributes(state);
  recordAdminAudit(state, {
    action: 'profile.attributes',
    summary: `session=${sessionId} fields=${entry?.provider ? Object.keys(entry.provider).length : 0}`,
  });
  await persistSettings(state);

  const flashParts = [];
  const hasValues = entry && entry.provider && Object.keys(entry.provider).length;
  flashParts.push(hasValues ? `Provider attributes saved for session "${sessionId}".` : `Provider attributes cleared for session "${sessionId}".`);
  if (errors.length) {
    flashParts.push(`Validation: ${errors.join(' ')}`);
  }
  return {
    flash: flashParts.join(' '),
    attributesSessionId: sessionId,
    attributesPayloadValue: renderAttributesPayload(entry?.provider),
  };
}

async function updateModules(state, body) {
  const definitions = listModuleDefinitions();
  const toggles = {};
  for (const definition of definitions) {
    toggles[definition.key] = Object.prototype.hasOwnProperty.call(body, `module_${definition.key}`);
  }
  const normalized = normalizeModuleSettings(toggles);
  state.settings = { ...(state.settings || {}), modules: normalized };
  const enabled = Object.entries(normalized)
    .filter(([, value]) => value)
    .map(([key]) => key);
  recordAdminAudit(state, {
    action: 'modules.update',
    summary: `enabled=${enabled.length ? enabled.join(',') : 'none'}`,
  });
  await persistSettings(state);
  return { flash: 'Module toggles updated. Reload to refresh navigation.' };
}

async function updateRateLimits(state, body) {
  const raw = body.rateLimitOverrides ?? '';
  const { overrides, errors } = parseRateLimitOverrides(raw);
  const hasOverrides = Object.keys(overrides).length > 0;

  if (!hasOverrides && errors.length) {
    return {
      flash: 'Rate limits not saved. Fix the errors below.',
      rateLimitOverridesValue: String(raw || ''),
      rateLimitErrors: renderRateLimitErrors(errors),
    };
  }

  state.settings = { ...(state.settings || {}), rateLimits: overrides };
  recordAdminAudit(state, {
    action: 'rate_limits.update',
    summary: `overrides=${Object.keys(overrides).length}`,
  });
  await persistSettings(state);

  const flash = errors.length
    ? `Rate limits saved with warnings (${errors.length} entries ignored).`
    : 'Rate limits saved.';

  return {
    flash,
    rateLimitOverridesValue: formatRateLimitOverrides(overrides),
    rateLimitErrors: renderRateLimitErrors(errors),
  };
}

function buildAdminViewModel(
  state,
  {
    flash,
    sessionForm = {},
    availableExtensions = [],
    providerFieldsValue,
    attributesSessionId,
    attributesPayloadValue,
    rateLimitOverridesValue,
    rateLimitErrors,
  } = {},
) {
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const defaultRole = resolveDefaultActorRole(state);
  const postingGate = evaluateAction(state, null, 'post');
  const extensions = state.extensions?.active || [];
  const roleFlags = roleSelectFlags(sessionForm.sessionRole || defaultRole);
  const extensionsList = renderExtensions(availableExtensions);
  const moduleToggles = listModuleToggles(state);
  const modulesList = renderModules(moduleToggles);
  const modulesSummary = moduleToggles.filter((mod) => mod.enabled).map((mod) => mod.key).join(', ') || 'None';
  const defaultElectionMode = state.settings?.groupPolicy?.electionMode || 'priority';
  const defaultConflictRule = state.settings?.groupPolicy?.conflictRule || 'highest_priority';
  const petitionQuorumAdvance = normalizeQuorumAdvance(state.settings?.petitionQuorumAdvance || 'discussion');
  const topicConfig = state.settings?.topicGardener || {};
  const topicAnchors = (topicConfig.anchors && topicConfig.anchors.length ? topicConfig.anchors : DEFAULT_TOPIC_ANCHORS).join(', ');
  const topicPinned = (topicConfig.pinned || []).join(', ');
  const replicationProfile = getReplicationProfile(state);
  const dataConfig = state.settings?.data || DATA_DEFAULTS;
  const providerFields = normalizeProviderFields(state.profileStructures || []);
  const providerFieldsValueRendered = providerFieldsValue ?? formatProviderFieldsForTextarea(providerFields);
  const attributesSessionIdValue = attributesSessionId || '';
  const attributesPayloadValueRendered = attributesPayloadValue || '';
  const auditEntries = Array.isArray(state.settings?.auditLog) ? state.settings.auditLog : [];
  const ledgerHash = computeLedgerHash([...state.uniquenessLedger]);
  const gossipIngest = isGossipEnabled(replicationProfile) ? 'on' : 'off';
  const transactionsList = renderTransactionsList(listTransactions(state, { limit: 8 }));
  const transactionSummariesList = renderTransactionSummariesList(
    filterVisibleEntries(state.transactionSummaries || [], state).slice(0, 8),
  );
  const gossipPushSummary = renderGossipSummary(state.gossipState, { emptyLabel: 'No outbound gossip runs yet.' });
  const gossipPushPeers = renderGossipPeers(state.gossipState, { emptyLabel: 'No outbound peer results recorded yet.' });
  const gossipPullSummary = renderGossipSummary(state.gossipPullState, { emptyLabel: 'No inbound gossip pulls yet.' });
  const gossipPullPeers = renderGossipPeers(state.gossipPullState, { emptyLabel: 'No inbound peer results recorded yet.' });
  const federationEnabled = isModuleEnabled(state, 'federation');
  const gossipAllowed = federationEnabled && isGossipEnabled(replicationProfile);
  let gossipDisabledNote = '';
  if (!federationEnabled) {
    gossipDisabledNote = 'Federation module disabled. Gossip sync controls are unavailable.';
  } else if (!isGossipEnabled(replicationProfile)) {
    gossipDisabledNote = 'Gossip ingest disabled in centralized data mode. Switch to hybrid or p2p to enable sync.';
  }
  const gossipPushDisabledAttr = gossipAllowed ? '' : 'disabled';
  const gossipPullDisabledAttr = gossipAllowed ? '' : 'disabled';
  const peerHealth = listPeerHealth(state);
  const peerHealthList = renderPeerHealthList(peerHealth);
    const peerHealthOptions = renderPeerHealthOptions(peerHealth, state.peers);
    const peerHealthCount = Object.keys(peerHealth || {}).length;
    const peerHealthResetDisabledAttr = peerHealthCount ? '' : 'disabled';
  const rateLimitOverrides = rateLimitOverridesValue ?? formatRateLimitOverrides(state.settings?.rateLimits || {});
  const rateLimitDefaults = renderRateLimitDefaults(DEFAULT_RATE_LIMITS);
  const rateLimitErrorsRendered = rateLimitErrors || '';

  return {
    circleName: effective.circleName,
    policyId: effective.id,
    enforceCircleChecked: effective.enforceCircle ? 'checked' : '',
    requireVerificationChecked: effective.requireVerification ? 'checked' : '',
    adminContact: effective.adminContact,
    preferredPeer: effective.preferredPeer,
    policyVersion: effective.version || POLICIES.version,
    initialized: effective.initialized,
    peersKnown: policy.peersKnown,
    ledgerEntries: policy.ledgerEntries,
    notes: effective.notes,
    firstRunNote: effective.initialized ? '' : 'First installation mode: configure policy and save to persist.',
    flash,
    postingGate: postingGate.allowed ? 'Open posting allowed (demo).' : postingGate.message || 'Verification required before posting.',
    extensionsSummary: extensions.length ? extensions.map((ext) => ext.id).join(', ') : 'None',
    modulesSummary: `Modules: ${modulesSummary}`,
    modulesList,
    defaultElectionModePriority: defaultElectionMode === 'priority' ? 'selected' : '',
    defaultElectionModeVote: defaultElectionMode === 'vote' ? 'selected' : '',
    defaultConflictHighest: defaultConflictRule === 'highest_priority' ? 'selected' : '',
    defaultConflictPrompt: defaultConflictRule === 'prompt_user' ? 'selected' : '',
    petitionQuorumAdvanceDiscussion: petitionQuorumAdvance === 'discussion' ? 'selected' : '',
    petitionQuorumAdvanceVote: petitionQuorumAdvance === 'vote' ? 'selected' : '',
    extensionsList,
    sessionIdValue: sessionForm.sessionId || '',
    sessionHandleValue: sessionForm.sessionHandle || '',
    sessionBannedChecked: sessionForm.banned ? 'checked' : '',
    sessionRoleUser: roleFlags.user,
    sessionRolePerson: roleFlags.person,
    sessionRoleDelegate: roleFlags.delegate,
    sessionRoleModerator: roleFlags.moderator,
    sessionRoleAdmin: roleFlags.admin,
    topicGardenerUrl: topicConfig.url || '',
    topicAnchors,
    topicPinned,
    dataProfile: describeProfile(replicationProfile),
    dataMode: replicationProfile.mode,
    dataAdapter: replicationProfile.adapter,
    dataValidation: replicationProfile.validationLevel,
    dataPreview: replicationProfile.allowPreviews ? 'on' : 'off',
    ledgerHash,
    gossipIngest,
    dataModeCentralized: dataConfig.mode === 'centralized' ? 'selected' : '',
    dataModeHybrid: dataConfig.mode === 'hybrid' ? 'selected' : '',
    dataModeP2P: dataConfig.mode === 'p2p' ? 'selected' : '',
    dataValidationStrict: dataConfig.validationLevel === 'strict' ? 'selected' : '',
    dataValidationObserve: dataConfig.validationLevel === 'observe' ? 'selected' : '',
    dataValidationOff: dataConfig.validationLevel === 'off' ? 'selected' : '',
    dataAdapterJson: dataConfig.adapter === 'json' ? 'selected' : '',
    dataAdapterMemory: dataConfig.adapter === 'memory' ? 'selected' : '',
    dataAdapterSql: dataConfig.adapter === 'sql' ? 'selected' : '',
    dataAdapterKv: dataConfig.adapter === 'kv' ? 'selected' : '',
    dataPreviewChecked: dataConfig.allowPreviews ? 'checked' : '',
    canonicalProfileSummary: describeCanonicalProfile(),
    providerFieldsValue: providerFieldsValueRendered,
    providerFieldCount: providerFields.length,
    attributesSessionId: attributesSessionIdValue,
    attributesPayloadValue: attributesPayloadValueRendered,
    auditLog: renderAuditLog(auditEntries),
    transactionsList,
    transactionSummariesList,
    gossipPushSummary,
    gossipPushPeers,
    gossipPullSummary,
    gossipPullPeers,
    gossipDisabledNote,
    gossipPushDisabledAttr,
    gossipPullDisabledAttr,
    peerHealthList,
    peerHealthOptions,
    peerHealthResetDisabledAttr,
    peerHealthCount,
    rateLimitOverridesValue: rateLimitOverrides,
    rateLimitDefaults,
    rateLimitErrors: rateLimitErrorsRendered,
  };
}

function renderAttributesPayload(provider = {}) {
  return Object.entries(provider || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function recordAdminAudit(state, { action, summary }) {
  const settings = state.settings || {};
  const log = settings.auditLog || [];
  const entry = {
    at: new Date().toISOString(),
    action,
    summary,
  };
  const nextLog = [...log, entry].slice(-50);
  state.settings = { ...settings, auditLog: nextLog };
}

function renderAuditLog(entries = []) {
  if (!entries.length) {
    return '<p class="muted small">No admin audit entries yet.</p>';
  }
  return `
    <ul class="stack small">
      ${entries
        .slice(-10)
        .reverse()
        .map((entry) => `<li><strong>${entry.action}</strong> — ${entry.summary} <span class="muted">${entry.at}</span></li>`)
        .join('')}
    </ul>
  `;
}

function renderTransactionsList(entries = []) {
  if (!entries.length) {
    return '<p class="muted small">No transactions logged yet.</p>';
  }
  const items = entries
    .slice(0, 8)
    .map((entry) => {
      const type = escapeHtml(String(entry.type || 'unknown'));
      const digest = escapeHtml(String(entry.digest || '').slice(0, 12));
      const actor = escapeHtml(String(entry.actorHash || 'anonymous').slice(0, 12));
      const petitionId = entry.petitionId ? escapeHtml(String(entry.petitionId).slice(0, 12)) : '';
      const time = escapeHtml(new Date(entry.createdAt || Date.now()).toLocaleString());
      return `<li><strong>${type}</strong> ${digest ? `· ${digest}` : ''} · actor ${actor}${
        petitionId ? ` · petition ${petitionId}` : ''
      } <span class="muted">${time}</span></li>`;
    })
    .join('');
  return `<ul class="stack small">${items}</ul>`;
}

function renderTransactionSummariesList(entries = []) {
  if (!entries.length) {
    return '<p class="muted small">No inbound summaries yet.</p>';
  }
  const items = entries
    .map((entry) => {
      const issuer = escapeHtml(String(entry.issuer || 'unknown'));
      const summary = escapeHtml(String(entry.summary || '').slice(0, 12));
      const policyLabel = entry.policy?.id ? `${entry.policy.id} v${entry.policy.version}` : 'policy unknown';
      const profileLabel = entry.profile?.mode ? `${entry.profile.mode}/${entry.profile.adapter || ''}` : 'profile unknown';
      const countLabel = Number.isFinite(entry.entryCount) ? `${entry.entryCount} digests` : 'digest count unknown';
      const receivedAt = escapeHtml(
        new Date(entry.receivedAt || entry.issuedAt || Date.now()).toLocaleString(),
      );
      const previewPill = entry.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : '';
      const signaturePill = entry.verification?.skipped ? '<span class="pill ghost">unsigned</span>' : '';
      const peerLabel = entry.peer ? `Peer ${escapeHtml(String(entry.peer))}` : '';
      return `
        <div class="list-row">
          <div>
            <p class="small">${issuer} · ${summary || 'summary'}</p>
            <p class="muted tiny">${escapeHtml(countLabel)} · ${escapeHtml(policyLabel)} · ${escapeHtml(profileLabel)}</p>
            ${peerLabel ? `<p class="muted tiny">${peerLabel}</p>` : ''}
          </div>
          <div>
            ${previewPill}
            ${signaturePill}
            <span class="muted tiny">${receivedAt}</span>
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}

function renderRateLimitDefaults(defaults = {}) {
  const entries = Object.entries(defaults || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return '<p class="muted small">No defaults available.</p>';
  const items = entries
    .map(([key, limit]) => {
      const windowSeconds = Math.round((limit.windowMs || 0) / 1000);
      return `<li><strong>${escapeHtml(key)}</strong> — ${limit.max} per ${windowSeconds}s</li>`;
    })
    .join('');
  return `<ul class="stack small">${items}</ul>`;
}

function renderRateLimitErrors(errors = []) {
  if (!errors || !errors.length) return '';
  const items = errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('');
  return `<ul class="stack small">${items}</ul>`;
}

function formatRateLimitOverrides(overrides = {}) {
  const entries = Object.entries(overrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return '';
  return entries
    .map(([key, limit]) => {
      const windowSeconds = Math.round((limit.windowMs || 0) / 1000);
      return `${key}:${windowSeconds}:${limit.max}`;
    })
    .join('\n');
}

function parseRateLimitOverrides(raw) {
  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  const overrides = {};
  const errors = [];
  if (!text) return { overrides, errors };

  const parsed = tryParseJson(text);
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const key = sanitizeText(entry?.key || '', 64).toLowerCase();
        if (!key) {
          errors.push('Rate limit entry missing key.');
          continue;
        }
        const normalized = normalizeLimit(entry);
        if (!normalized) {
          errors.push(`Rate limit "${key}" is invalid.`);
          continue;
        }
        overrides[key] = normalized;
      }
      return { overrides, errors };
    }
    for (const [keyRaw, value] of Object.entries(parsed)) {
      const key = sanitizeText(keyRaw, 64).toLowerCase();
      if (!key) {
        errors.push('Rate limit entry missing key.');
        continue;
      }
      const normalized = normalizeLimit(value);
      if (!normalized) {
        errors.push(`Rate limit "${key}" is invalid.`);
        continue;
      }
      overrides[key] = normalized;
    }
    return { overrides, errors };
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const parsedLine = parseRateLimitLine(line);
    if (!parsedLine) {
      errors.push(`Invalid rate limit line: "${line}". Expected key:windowSeconds:max.`);
      continue;
    }
    const { key, windowSeconds, max } = parsedLine;
    const normalized = normalizeLimit({ windowSeconds, max });
    if (!normalized) {
      errors.push(`Rate limit "${key}" is invalid.`);
      continue;
    }
    overrides[key] = normalized;
  }
  return { overrides, errors };
}

function parseRateLimitLine(line) {
  const parts = line.split(':').map((part) => part.trim());
  if (parts.length < 3) {
    return null;
  }
  const key = sanitizeText(parts[0], 64).toLowerCase();
  const windowSeconds = parseRateNumber(parts[1]);
  const max = parseRateNumber(parts[2]);
  if (!key || !Number.isFinite(windowSeconds) || !Number.isFinite(max)) return null;
  return { key, windowSeconds, max };
}

function parseRateNumber(value) {
  if (value === undefined || value === null) return NaN;
  const text = String(value).trim().toLowerCase();
  if (!text) return NaN;
  const cleaned = text.replace(/seconds?|secs?|s$/g, '');
  return Number(cleaned);
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function renderGossipSummary(gossipState = {}, { emptyLabel = 'No gossip runs yet.' } = {}) {
  if (!gossipState.lastAttemptAt) {
    return `<p class="muted small">${escapeHtml(emptyLabel)}</p>`;
  }
  const lines = [];
  if (gossipState.running) {
    lines.push('Outbound gossip in progress.');
  }
  lines.push(`Last attempt: ${formatTimestamp(gossipState.lastAttemptAt)}`);
  if (gossipState.lastSuccessAt) {
    lines.push(`Last success: ${formatTimestamp(gossipState.lastSuccessAt)}`);
  }
  if (gossipState.lastSummary?.skipped) {
    lines.push(`Last run skipped: ${gossipState.lastSummary.skipped}.`);
  } else if (gossipState.lastSummary) {
    const ledger = gossipState.lastSummary.ledger || {};
    const votes = gossipState.lastSummary.votes || {};
    const transactions = gossipState.lastSummary.transactions || {};
    const voteCounts = [];
    if (Number.isFinite(votes.added) && votes.added > 0) voteCounts.push(`+${votes.added}`);
    if (Number.isFinite(votes.updated) && votes.updated > 0) voteCounts.push(`~${votes.updated}`);
    const voteTail = voteCounts.length ? ` (${voteCounts.join(', ')})` : '';
    const voteLine = votes.skipped ? 'votes skipped' : `votes ${votes.ok || 0}/${votes.sent || 0} ok${voteTail}`;
    const transactionCounts = [];
    if (Number.isFinite(transactions.added) && transactions.added > 0) transactionCounts.push(`+${transactions.added}`);
    if (Number.isFinite(transactions.updated) && transactions.updated > 0) transactionCounts.push(`~${transactions.updated}`);
    const transactionTail = transactionCounts.length ? ` (${transactionCounts.join(', ')})` : '';
    const transactionLine = transactions.skipped
      ? 'transactions skipped'
      : `transactions ${transactions.ok || 0}/${transactions.sent || 0} ok${transactionTail}`;
    lines.push(`Ledger ${ledger.ok || 0}/${ledger.sent || 0} ok · ${voteLine} · ${transactionLine}`);
  }
  if (gossipState.lastError) {
    lines.push(`Last error: ${gossipState.lastError}`);
  }
  return lines.map((line) => `<p class="muted small">${escapeHtml(line)}</p>`).join('');
}

function renderGossipPeers(gossipState = {}, { emptyLabel = 'No peer results recorded yet.' } = {}) {
  const results = gossipState.peerResults || [];
  if (!results.length) {
    return `<p class="muted small">${escapeHtml(emptyLabel)}</p>`;
  }
  const items = results
    .slice(0, 8)
    .map((result) => {
      const ledgerStatus = formatGossipStatus(result.ledger);
      const votesStatus = formatGossipStatus(result.votes);
      const transactionsStatus = formatGossipStatus(result.transactions);
      return `<li><strong>${escapeHtml(result.peer)}</strong> · ledger ${escapeHtml(ledgerStatus)} · votes ${escapeHtml(
        votesStatus,
      )} · transactions ${escapeHtml(transactionsStatus)}</li>`;
    })
    .join('');
  return `<ul class="stack small">${items}</ul>`;
}

function renderPeerHealthList(peerHealth = {}) {
  const entries = Object.entries(peerHealth || {});
  if (!entries.length) {
    return '<p class="muted small">No peer health records yet.</p>';
  }
  const items = entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([peer, entry]) => {
      const score = Number(entry.score) || 0;
      const quarantined = entry.quarantineUntil && Date.parse(entry.quarantineUntil) > Date.now();
      const status = quarantined ? `quarantined until ${formatTimestamp(entry.quarantineUntil)}` : 'active';
      const lastFailure = entry.lastFailureReason ? `last failure: ${entry.lastFailureReason}` : 'no failures';
      return `<li><strong>${escapeHtml(peer)}</strong> · score ${score} · ${escapeHtml(status)} · ${escapeHtml(
        lastFailure,
      )}</li>`;
    })
    .join('');
  return `<ul class="stack small">${items}</ul>`;
}

function renderPeerHealthOptions(peerHealth = {}, peers = new Set()) {
  const keys = new Set();
  for (const key of Object.keys(peerHealth || {})) {
    if (key) keys.add(key);
  }
  if (peers) {
    for (const peer of peers) {
      if (peer) keys.add(peer);
    }
  }
  const list = [...keys].sort((a, b) => a.localeCompare(b));
  if (!list.length) {
    return '<option value="">No peers recorded</option>';
  }
  return list.map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(key)}</option>`).join('');
}

function formatGossipStatus(status = {}) {
  if (!status) return 'unknown';
  if (status.skipped) return 'skipped';
  if (status.ok) {
    const added = Number.isFinite(status.added) ? status.added : null;
    const updated = Number.isFinite(status.updated) ? status.updated : null;
    if (added !== null || updated !== null) {
      const counts = [added !== null ? `+${added}` : null, updated !== null ? `~${updated}` : null]
        .filter(Boolean)
        .join(', ');
      return status.status ? `ok (${status.status}, ${counts})` : `ok (${counts})`;
    }
    return status.status ? `ok (${status.status})` : 'ok';
  }
  if (status.error) return truncateText(status.error, 80);
  if (status.status) return `status ${status.status}`;
  return 'failed';
}

function formatTimestamp(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function truncateText(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function formatGossipFlash(summary) {
  if (!summary) return 'Gossip sync skipped.';
  if (summary.skipped) {
    return `Gossip sync skipped (${summary.skipped}).`;
  }
  const ledger = summary.ledger || {};
  const votes = summary.votes || {};
  const transactions = summary.transactions || {};
  const ledgerLine = `ledger ${ledger.ok || 0}/${ledger.sent || 0} ok`;
  const votesLine = votes.skipped ? 'votes skipped' : `votes ${votes.ok || 0}/${votes.sent || 0} ok`;
  const transactionsLine = transactions.skipped
    ? 'transactions skipped'
    : `transactions ${transactions.ok || 0}/${transactions.sent || 0} ok`;
  if (summary.errors?.length) {
    return `Gossip sync completed with errors: ${ledgerLine}, ${votesLine}, ${transactionsLine}.`;
  }
  return `Gossip sync complete: ${ledgerLine}, ${votesLine}, ${transactionsLine}.`;
}

function roleSelectFlags(role) {
  return {
    user: role === 'user' ? 'selected' : '',
    person: role === 'person' ? 'selected' : '',
    delegate: role === 'delegate' ? 'selected' : '',
    moderator: role === 'moderator' ? 'selected' : '',
    admin: role === 'admin' ? 'selected' : '',
  };
}

function normalizeQuorumAdvance(value) {
  const normalized = sanitizeText(value || '', 24).toLowerCase();
  return normalized === 'vote' ? 'vote' : 'discussion';
}

function renderExtensions(list) {
  if (!list || !list.length) return '<p class="muted small">No extensions discovered.</p>';
  return list
    .map((ext) => {
      const meta = ext.meta || {};
      const description = meta.description || '';
      return `
        <label class="field checkbox">
          <input type="checkbox" name="extensions" value="${ext.id}" ${ext.enabled ? 'checked' : ''} />
          <span>${ext.id} — ${description}</span>
        </label>
      `;
    })
    .join('\n');
}

function renderModules(list) {
  if (!list || !list.length) return '<p class="muted small">No module toggles available.</p>';
  return list
    .map((mod) => {
      const requires = mod.requires?.length ? `Requires: ${mod.requires.join(', ')}` : '';
      const description = [mod.description, requires].filter(Boolean).join(' ');
      return `
        <label class="field checkbox">
          <input type="checkbox" name="module_${mod.key}" ${mod.enabled ? 'checked' : ''} data-module-toggle="${mod.key}" />
          <span>${mod.label} — ${description || 'Optional module'}</span>
        </label>
      `;
    })
    .join('\n');
}
