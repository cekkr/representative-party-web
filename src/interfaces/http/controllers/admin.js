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
import { evaluateAction, getCirclePolicyState, getEffectivePolicy } from '../../../modules/circle/policy.js';
import { listModuleDefinitions, listModuleToggles, normalizeModuleSettings } from '../../../modules/circle/modules.js';
import { listAvailableExtensions } from '../../../modules/extensions/registry.js';
import { describeProfile, getReplicationProfile, isGossipEnabled } from '../../../modules/federation/replication.js';
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

  const prev = state.settings || {};
  const enforceCircle = parseBoolean(body.enforceCircle, false);
  const requireVerification = parseBoolean(body.requireVerification, false);
  const newPeer = sanitizeText(body.peerJoin || '', 200);
  const preferredPeer = sanitizeText(body.preferredPeer || prev.preferredPeer || '', 200);
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
  const peersToAdd = Array.from(new Set([newPeer, preferredPeer].filter(Boolean)));
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
  const role = sanitizeText(body.sessionRole || 'person', 32) || 'person';
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

function buildAdminViewModel(
  state,
  { flash, sessionForm = {}, availableExtensions = [], providerFieldsValue, attributesSessionId, attributesPayloadValue } = {},
) {
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const postingGate = evaluateAction(state, null, 'post');
  const extensions = state.extensions?.active || [];
  const roleFlags = roleSelectFlags(sessionForm.sessionRole || 'person');
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
  const transactionsList = renderTransactionsList(state.transactions || []);

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

function roleSelectFlags(role) {
  return {
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
