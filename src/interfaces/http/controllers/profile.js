import { getPerson } from '../../../modules/identity/person.js';
import { persistProfileAttributes } from '../../../infra/persistence/storage.js';
import {
  normalizeProviderFields,
  parseAttributePayloadWithValidation,
  upsertProviderAttributes,
} from '../../../modules/structure/structureManager.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { getActorLabels, resolvePersonHandle } from '../views/actorLabel.js';
import { renderPage } from '../views/templates.js';
import {
  buildProfileValues,
  normalizeProfilePayload,
  renderProfileForm,
  renderProfileSummary,
} from '../views/profileView.js';

export async function renderProfile({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  return renderProfilePage({ req, res, state, wantsPartial, person });
}

export async function updateProfileAttributes({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  if (!person?.sessionId) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to update profile.' });
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
  const body = await readRequestBody(req);
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

async function renderProfilePage({ req, res, state, wantsPartial, person, errors = [], values, flash, entry, consentChecked }) {
  const actorLabels = getActorLabels(state);
  const providerFields = normalizeProviderFields(state.profileStructures || []);
  const profileEntry = entry || (person ? findProfileAttributes(state, person.sessionId) : null);
  const defaultValues = values || buildProfileValues(providerFields, profileEntry);
  const updatedAt = profileEntry?.updatedAt ? new Date(profileEntry.updatedAt).toLocaleString() : '';
  const profileSchema = state.settings?.profileSchema || {};
  const schemaParts = [`Schema v${Number(profileSchema.version || 0)}`];
  if (profileSchema.updatedAt) {
    schemaParts.push(`updated ${new Date(profileSchema.updatedAt).toLocaleString()}`);
  }
  if (profileSchema.updatedBy) {
    schemaParts.push(`by ${profileSchema.updatedBy}`);
  }
  const profileSchemaNote = schemaParts.join(' · ');
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
  const profileFlash = flash
    ? `<div class="callout"><p class="muted small">${escapeHtml(flash)}</p></div>`
    : '';
  const html = await renderPage(
    'profile',
    {
      personHandle: resolvePersonHandle(person),
      profileForm,
      profileSummary,
      profileFlash,
      profileSchemaNote,
    },
    { wantsPartial, title: 'Profile', state },
  );
  return sendHtml(res, html);
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
