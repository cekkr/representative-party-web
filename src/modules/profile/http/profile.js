import { getPerson } from '../../identity/person.js';
import { persistProfileAttributes } from '../../../infra/persistence/storage.js';
import {
  normalizeProviderFields,
  parseAttributePayloadWithValidation,
  upsertProviderAttributes,
} from '../../structure/structureManager.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { normalizeVerbosityMode, parseBoolean } from '../../../shared/utils/parse.js';
import { getActorLabels, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import {
  buildProfileValues,
  normalizeProfilePayload,
  renderProfileForm,
  renderProfileSummary,
  renderUiPreferencesForm,
} from '../../../interfaces/http/views/profileView.js';
import { invalidateSessionIndex, validateHandleChoice } from '../../identity/sessions.js';
import { persistSessions } from '../../../infra/persistence/storage.js';
import { logTransaction } from '../../transactions/registry.js';

export async function renderProfile({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  return renderProfilePage({ req, res, state, wantsPartial, person });
}

export async function updateProfileAttributes({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  if (!person?.sessionId) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to update profile.' });
  }
  const body = await readRequestBody(req);
  const intent = body.intent || 'profile';
  if (intent === 'handle') {
    const currentSession = state.sessions.get(person.sessionId);
    if (!currentSession) {
      return sendJson(res, 404, { error: 'session_not_found', message: 'Session not found.' });
    }
    const result = validateHandleChoice(state, body.handle, { sessionId: person.sessionId });
    if (!result.ok) {
      return renderProfilePage({
        req,
        res,
        state,
        wantsPartial,
        person,
        handleErrors: [result.error],
        handleValue: String(body.handle || ''),
      });
    }
    const previousHandle = currentSession.handle || person.handle;
    const next = { ...currentSession, handle: result.handle };
    state.sessions.set(person.sessionId, next);
    invalidateSessionIndex(state);
    await persistSessions(state);
    await logTransaction(state, {
      type: 'handle_set',
      actorHash: person.pidHash,
      payload: { handle: result.handle, previousHandle },
    });
    return renderProfilePage({
      req,
      res,
      state,
      wantsPartial,
      person: { ...person, ...next },
      handleFlash: `Handle updated to @${result.handle}.`,
    });
  }
  if (intent === 'ui-preferences') {
    const currentSession = state.sessions.get(person.sessionId);
    if (!currentSession) {
      return sendJson(res, 404, { error: 'session_not_found', message: 'Session not found.' });
    }
    const normalized = normalizeVerbosityMode(body.uiVerbosity);
    const uiSettings = normalizeInterfaceSettings(body);
    const next = { ...currentSession };
    const flashParts = [];
    if (normalized) {
      next.uiVerbosity = normalized;
      flashParts.push(`UI verbosity set to ${normalized}.`);
    } else {
      delete next.uiVerbosity;
      flashParts.push('UI verbosity reset to Circle default.');
    }
    next.uiSettings = uiSettings;
    flashParts.push('Interface defaults updated.');
    state.sessions.set(person.sessionId, next);
    invalidateSessionIndex(state);
    await persistSessions(state);
    return renderProfilePage({
      req,
      res,
      state,
      wantsPartial,
      person: { ...person, ...next },
      uiFlash: flashParts.join(' '),
    });
  }
  const providerFields = normalizeProviderFields(state.profileStructures || []);
  if (!providerFields.length) {
    return renderProfilePage({
      req,
      res,
      state,
      wantsPartial,
      person,
      errors: ['No provider-local fields are configured yet.'],
    });
  }
  const rawPayload = normalizeProfilePayload(providerFields, body);
  const { attributes, errors } = parseAttributePayloadWithValidation(rawPayload, providerFields);
  const missingRequired = listMissingRequired(providerFields, attributes);
  if (missingRequired.length) {
    errors.push(`Missing required fields: ${missingRequired.join(', ')}`);
  }
  if (!parseBoolean(body.profileConsent, false)) {
    errors.push('Consent is required to store provider-local attributes.');
  }
  if (errors.length) {
    return renderProfilePage({
      req,
      res,
      state,
      wantsPartial,
      person,
      errors,
      values: rawPayload,
      consentChecked: parseBoolean(body.profileConsent, false),
    });
  }

  const entry = upsertProviderAttributes(state, {
    sessionId: person.sessionId,
    handle: person.handle,
    attributes,
    replace: true,
  });
  await persistProfileAttributes(state);

  return renderProfilePage({
    req,
    res,
    state,
    wantsPartial,
    person,
    flash: 'Profile attributes saved.',
    entry,
  });
}

async function renderProfilePage({
  req,
  res,
  state,
  wantsPartial,
  person,
  errors = [],
  values,
  flash,
  uiFlash,
  entry,
  consentChecked,
  handleErrors = [],
  handleValue,
  handleFlash,
}) {
  const actorLabels = getActorLabels(state);
  const providerFields = normalizeProviderFields(state.profileStructures || []);
  const profileEntry = entry || (person ? findProfileAttributes(state, person.sessionId) : null);
  const defaultValues = values || buildProfileValues(providerFields, profileEntry);
  const updatedAt = formatTimestamp(profileEntry?.updatedAt);
  const profileSchema = state.settings?.profileSchema || {};
  const schemaParts = [`Schema v${Number(profileSchema.version || 0)}`];
  if (profileSchema.updatedAt) {
    schemaParts.push(`updated ${formatTimestamp(profileSchema.updatedAt)}`);
  }
  if (profileSchema.updatedBy) {
    schemaParts.push(`by ${profileSchema.updatedBy}`);
  }
  const profileSchemaNote = schemaParts.join(' · ');
  const currentSchemaVersion = Number(profileSchema.version || 0);
  const entrySchemaVersion = Number(profileEntry?.schemaVersion || 0);
  const profileSchemaWarning =
    profileEntry && currentSchemaVersion && entrySchemaVersion < currentSchemaVersion
      ? `<div class="callout"><p class="muted small">Profile schema updated since your last save (v${entrySchemaVersion} → v${currentSchemaVersion}). Review and resave to keep provider-local fields consistent.</p></div>`
      : '';
  const profileForm = renderProfileForm({
    person,
    actorLabels,
    providerFields,
    values: defaultValues,
    errors,
    consentChecked: Boolean(consentChecked),
    updatedAt,
  });
  const profileSummary = renderProfileSummary(person, actorLabels);
  const handleForm = renderHandleForm({
    person,
    actorLabels,
    errors: handleErrors,
    value: handleValue,
    flash: handleFlash,
  });
  const defaultVerbosity = normalizeVerbosityMode(state.settings?.verbosityMode) || 'full';
  const overrideVerbosity = normalizeVerbosityMode(person?.uiVerbosity);
  const effectiveVerbosity = overrideVerbosity || defaultVerbosity;
  const uiPreferencesForm = renderUiPreferencesForm({
    person,
    defaultMode: defaultVerbosity,
    overrideMode: overrideVerbosity,
    effectiveMode: effectiveVerbosity,
    uiSettings: normalizeInterfaceSettings(person?.uiSettings || {}),
    flash: uiFlash,
  });
  const profileFlash = flash
    ? `<div class="callout"><p class="muted small">${escapeHtml(flash)}</p></div>`
    : '';
  const html = await renderPage(
    'profile',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      profileForm,
      profileSummary,
      handleForm,
      profileFlash,
      uiPreferencesForm,
      profileSchemaNote,
      profileSchemaWarning,
    },
    { wantsPartial, title: 'Profile', state },
  );
  return sendHtml(res, html);
}

function renderHandleForm({ person, actorLabels, errors = [], value, flash } = {}) {
  if (!person) {
    return '<p class="muted small">Verify a session to choose a handle.</p>';
  }
  const actorLabel = actorLabels?.actorLabel || 'user';
  const current = escapeHtml(person.handle || '');
  const inputValue = escapeHtml(value ?? person.handle ?? '');
  const flashBlock = flash ? `<div class="callout"><p class="muted small">${escapeHtml(flash)}</p></div>` : '';
  const errorBlock = errors.length
    ? `<div class="callout warning"><ul class="plain">${errors
        .map((error) => `<li class="muted small">${escapeHtml(error)}</li>`)
        .join('')}</ul></div>`
    : '';
  return `
    ${flashBlock}
    ${errorBlock}
    <form class="stack" method="post" action="/profile" data-enhance="profile-handle">
      <input type="hidden" name="intent" value="handle" />
      <label class="field">
        <span>Public handle</span>
        <input name="handle" value="${inputValue}" placeholder="your-handle" maxlength="30" required />
      </label>
      <p class="muted tiny">This is how other ${escapeHtml(actorLabels?.actorLabelPlural || 'users')} see you across the Circle (currently <strong>@${current || actorLabel}</strong>). Letters, numbers, dashes, underscores; 3-30 characters. Your blinded hash stays the canonical identifier.</p>
      <button class="cta" type="submit">Save handle</button>
    </form>
  `;
}

function findProfileAttributes(state, sessionId) {
  if (!state?.profileAttributes || !sessionId) return null;
  return state.profileAttributes.find((entry) => entry.sessionId === sessionId) || null;
}

function listMissingRequired(fields = [], attributes = {}) {
  const missing = [];
  for (const field of fields) {
    if (!field?.required) continue;
    if (Object.prototype.hasOwnProperty.call(attributes, field.key)) continue;
    missing.push(field.key);
  }
  return missing;
}

function normalizeInterfaceSettings(source = {}) {
  const payload = source && typeof source === 'object' ? source : {};
  return {
    largeText: parseBoolean(payload.uiLargeText ?? payload.largeText, false),
    reducedMotion: parseBoolean(payload.uiReducedMotion ?? payload.reducedMotion, false),
    compactNav: parseBoolean(payload.uiCompactNav ?? payload.compactNav, false),
    keepComposerOpen: parseBoolean(payload.uiKeepComposerOpen ?? payload.keepComposerOpen, false),
    partialNavigation: parseBoolean(payload.uiPartialNavigation ?? payload.partialNavigation, true),
  };
}
