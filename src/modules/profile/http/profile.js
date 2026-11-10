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
import { getActorLabels, renderActorAvatar, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderContextPanel } from '../../../interfaces/http/views/contextPanel.js';
import { renderFormErrors, renderFormNotice } from '../../../interfaces/http/views/formFeedback.js';
import { isModuleEnabled } from '../../circle/modules.js';
import { getCirclePolicyState } from '../../circle/policy.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import {
  buildProfileValues,
  normalizeProfilePayload,
  renderProfileForm,
  renderUiPreferencesForm,
} from '../../../interfaces/http/views/profileView.js';
import { normalizeInterfaceSettings } from '../../../interfaces/http/views/interfaceSettings.js';
import { applyIdentityStanding, invalidateSessionIndex, validateHandleChoice } from '../../identity/sessions.js';
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
    const result = validateHandleChoice(state, body.handle, { sessionId: person.sessionId, pidHash: person.pidHash });
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
    // The handle names the person on every device they verified.
    applyIdentityStanding(state, person.pidHash, { handle: result.handle });
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
    // The topbar's verbosity toggle submits only its override. A full
    // preferences submission still replaces the stored interface defaults.
    const verbosityOnly = Object.hasOwn(body, 'uiVerbosity')
      && Object.keys(body).every((key) => key === 'intent' || key === 'uiVerbosity');
    const next = { ...currentSession };
    const flashParts = [];
    if (normalized) {
      next.uiVerbosity = normalized;
      flashParts.push(`UI verbosity set to ${normalized}.`);
    } else {
      delete next.uiVerbosity;
      flashParts.push('UI verbosity reset to Circle default.');
    }
    if (!verbosityOnly) {
      next.uiSettings = normalizeInterfaceSettings(body);
      flashParts.push('Interface defaults updated.');
    }
    state.sessions.set(person.sessionId, next);
    invalidateSessionIndex(state);
    await persistSessions(state);
    return renderProfilePage({
      req,
      res,
      state,
      wantsPartial,
      person: { ...person, ...next, uiVerbosity: next.uiVerbosity },
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
      ? `<div class="callout is-warning" role="note"><p class="small">The provider changed these fields since your last save (schema v${entrySchemaVersion} → v${currentSchemaVersion}). Review them and save again.</p></div>`
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
  const profileFlash = renderFormNotice(flash);
  const heading = renderProfileHeading(state, person, actorLabels);
  const html = await renderPage(
    'profile',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      ...heading,
      profileForm,
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

// The record header follows the People profile: avatar, @handle, role and
// verification state, then one action. A guest sees the verification path.
function renderProfileHeading(state, person, actorLabels) {
  if (!person?.sessionId) {
    return {
      profileAvatar: '',
      profileTitle: 'Profile',
      profileStatus: '<span class="pill ghost">Not verified</span>',
      profileSummaryLine: escapeHtml(`Verify with your wallet to choose a handle, save provider-local fields, and keep interface defaults for your ${actorLabels?.actorLabel || 'user'} session.`),
      profileAction: '<p class="workspace-heading__actions"><a class="cta" href="/auth/eudi" data-partial>Verify with your wallet</a></p>',
      profileDetails: renderContextPanel({
        guidance: ['Only a blinded hash of your wallet credential is stored. No identity document is retained.'],
      }),
    };
  }
  const handle = resolvePersonHandle(person, '');
  const role = person.role || actorLabels?.actorLabel || 'user';
  const pills = [`<span class="pill ghost">${escapeHtml(role)}</span>`];
  pills.push(person.banned
    ? '<span class="pill stance stance--concern">Banned</span>'
    : '<span class="pill stance stance--support">Verified</span>');
  const canOpenPublic = Boolean(person.pidHash) && isModuleEnabled(state, 'delegation');
  const action = canOpenPublic
    ? `<p class="workspace-heading__actions"><a class="ghost" href="/delegates/${encodeURIComponent(person.pidHash)}" data-partial>View your public profile</a></p>`
    : '';
  const policy = getCirclePolicyState(state);
  const hashCue = person.pidHash ? `${String(person.pidHash).slice(0, 8)}…` : 'unavailable';
  const verifiedAt = formatTimestamp(person.verifiedAt);
  return {
    profileAvatar: person.pidHash ? renderActorAvatar(state, person.pidHash, { size: 'lg' }) : '',
    profileTitle: handle ? `@${escapeHtml(handle)}` : 'Profile',
    profileStatus: pills.join(' '),
    profileSummaryLine: 'Your handle, the fields this provider keeps for you, and your interface defaults.',
    profileAction: action,
    profileDetails: renderContextPanel({
      facts: [
        { term: 'Handle', value: handle ? `@${handle}` : 'Not set' },
        { term: 'Role', value: role },
        { term: 'Hash cue', value: hashCue },
        verifiedAt ? { term: 'Verified', value: verifiedAt } : null,
        { term: 'Circle enforcement', value: policy?.enforcement || 'unknown' },
      ].filter(Boolean),
      guidance: ['Only a blinded hash of your wallet credential is stored. Your handle can change; the hash cannot.'],
    }),
  };
}

function renderHandleForm({ person, actorLabels, errors = [], value, flash } = {}) {
  if (!person?.sessionId) {
    return '<p class="muted small">Verify a session to choose a handle.</p>';
  }
  const actorLabel = actorLabels?.actorLabel || 'user';
  const current = escapeHtml(person.handle || '');
  const inputValue = escapeHtml(value ?? person.handle ?? '');
  const errorId = 'profile-handle-error';
  const describedBy = errors.length ? `profile-handle-hint ${errorId}` : 'profile-handle-hint';
  const invalid = errors.length ? ' aria-invalid="true"' : '';
  return `
    ${renderFormNotice(flash)}
    ${renderFormErrors(errors, { id: errorId, title: 'Handle not saved' })}
    <form class="stack" method="post" action="/profile#profile-handle" data-enhance="profile-handle">
      <input type="hidden" name="intent" value="handle" />
      <label class="field">
        <span>Handle</span>
        <input id="profile-handle-input" name="handle" value="${inputValue}" placeholder="firstname.lastname" maxlength="30" autocomplete="nickname" spellcheck="false" required aria-describedby="${describedBy}"${invalid} />
      </label>
      <p class="muted tiny" id="profile-handle-hint">Currently <strong>@${current || escapeHtml(actorLabel)}</strong>. 3–30 letters, numbers, dashes, underscores, or dots (not at the start or end, and never two in a row).</p>
      <div class="cta-row">
        <button class="cta" type="submit">Save handle</button>
      </div>
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

