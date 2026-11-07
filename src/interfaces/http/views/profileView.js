import { escapeHtml } from '../../../shared/utils/text.js';
import { renderFormErrors, renderFormNotice } from './formFeedback.js';

const FIELD_PREFIX = 'profile_';

export function renderProfileForm({
  person,
  actorLabels,
  providerFields = [],
  values = {},
  errors = [],
  consentChecked = false,
  updatedAt,
} = {}) {
  if (!person) {
    return `
      <div class="callout">
        <p class="muted small">Verify your wallet to update provider-local profile fields.</p>
        <a class="ghost" href="/auth/eudi" data-partial>Verify wallet</a>
      </div>
    `;
  }
  if (!providerFields.length) {
    return `
      <div class="callout">
        <p class="muted small">No provider-local fields are configured yet.</p>
        <p class="muted small">Ask an admin to add optional fields for contact info or consent preferences.</p>
      </div>
    `;
  }
  const { formErrors, fieldErrors } = splitProfileErrors(errors, providerFields);
  const errorsBlock = renderErrors(formErrors);
  const fields = providerFields
    .map((field) => renderProviderField(field, values[field.key], fieldErrors[field.key] || []))
    .join('\n');
  const updatedLine = updatedAt ? `<p class="muted small">Last updated: ${escapeHtml(updatedAt)}</p>` : '';
  const consentLabel = `I consent to storing my provider-local profile fields on this server.`;
  return `
    ${errorsBlock}
    <form class="stack" method="post" action="/profile#profile-attributes" data-enhance="profile">
      ${fields}
      <label class="field checkbox">
        <input type="checkbox" name="profileConsent" ${consentChecked ? 'checked' : ''} required />
        <span>${escapeHtml(consentLabel)}</span>
      </label>
      <div class="cta-row">
        <button class="cta" type="submit">Save profile</button>
      </div>
    </form>
    ${updatedLine}
    <p class="muted tiny">Leaving an optional field blank clears it. Only verified ${escapeHtml(actorLabels?.actorLabelPlural || 'users')} can edit these fields.</p>
  `;
}

export function renderUiPreferencesForm({
  person,
  defaultMode = 'full',
  overrideMode,
  effectiveMode,
  uiSettings = {},
  flash,
} = {}) {
  if (!person) {
    return `
      <div class="callout">
        <p class="muted small">Verify your wallet to set per-session UI preferences.</p>
      </div>
    `;
  }
  const selection = overrideMode || 'default';
  const defaultLabel = defaultMode === 'compact' ? 'Compact' : 'Full';
  const effectiveLabel = effectiveMode === 'compact' ? 'Compact' : 'Full';
  const flashNote = renderFormNotice(flash);
  const normalizedSettings = {
    largeText: uiSettings?.largeText === true,
    reducedMotion: uiSettings?.reducedMotion === true,
    compactNav: uiSettings?.compactNav === true,
    keepComposerOpen: uiSettings?.keepComposerOpen === true,
    partialNavigation: uiSettings?.partialNavigation !== false,
  };
  const checked = (value) => (value ? 'checked' : '');
  return `
    ${flashNote}
    <form class="stack" method="post" action="/profile#profile-interface-defaults" data-enhance="profile">
      <input type="hidden" name="intent" value="ui-preferences" />
      <label class="field">
        <span>UI verbosity</span>
        <select name="uiVerbosity">
          <option value="default" ${selection === 'default' ? 'selected' : ''}>Use Circle default (${defaultLabel})</option>
          <option value="full" ${selection === 'full' ? 'selected' : ''}>Full (show guidance + telemetry cues)</option>
          <option value="compact" ${selection === 'compact' ? 'selected' : ''}>Compact (hide verbose cues)</option>
        </select>
      </label>
      <fieldset class="stack settings-fieldset">
        <legend class="small">Comfort and navigation</legend>
        <label class="field checkbox">
          <input type="hidden" name="uiLargeText" value="off" />
          <input type="checkbox" name="uiLargeText" ${checked(normalizedSettings.largeText)} />
          <span>Larger text scale</span>
        </label>
        <label class="field checkbox">
          <input type="hidden" name="uiReducedMotion" value="off" />
          <input type="checkbox" name="uiReducedMotion" ${checked(normalizedSettings.reducedMotion)} />
          <span>Reduced motion</span>
        </label>
        <label class="field checkbox">
          <input type="hidden" name="uiCompactNav" value="off" />
          <input type="checkbox" name="uiCompactNav" ${checked(normalizedSettings.compactNav)} />
          <span>Compact side navigation</span>
        </label>
        <label class="field checkbox">
          <input type="hidden" name="uiKeepComposerOpen" value="off" />
          <input type="checkbox" name="uiKeepComposerOpen" ${checked(normalizedSettings.keepComposerOpen)} />
          <span>Keep social composer open while scrolling</span>
        </label>
        <label class="field checkbox">
          <input type="hidden" name="uiPartialNavigation" value="off" />
          <input type="checkbox" name="uiPartialNavigation" ${checked(normalizedSettings.partialNavigation)} />
          <span>Fast partial navigation</span>
        </label>
      </fieldset>
      <div class="cta-row">
        <button class="cta" type="submit">Save interface defaults</button>
      </div>
    </form>
    <p class="muted tiny">Current verbosity: ${escapeHtml(effectiveLabel)}.</p>
  `;
}

export function buildProfileValues(providerFields = [], entry) {
  const values = {};
  const provider = entry?.provider || {};
  for (const field of providerFields) {
    if (!field?.key) continue;
    if (Object.prototype.hasOwnProperty.call(provider, field.key)) {
      values[field.key] = provider[field.key];
    }
  }
  return values;
}

export function normalizeProfilePayload(providerFields = [], body = {}) {
  const raw = {};
  for (const field of providerFields) {
    if (!field?.key) continue;
    const inputKey = `${FIELD_PREFIX}${field.key}`;
    if (field.type === 'boolean') {
      raw[field.key] = Object.prototype.hasOwnProperty.call(body, inputKey);
    } else {
      raw[field.key] = body[inputKey] ?? '';
    }
  }
  return raw;
}

function renderProviderField(field, value, errors = []) {
  const label = escapeHtml(field.label || field.key || 'Field');
  const required = field.required ? 'required' : '';
  const key = escapeHtml(field.key || '');
  const inputId = `profile-field-${key}`;
  const describedIds = [];
  const description = field.description
    ? `<span class="muted small" id="${inputId}-hint">${escapeHtml(field.description)}</span>`
    : '';
  if (field.description) describedIds.push(`${inputId}-hint`);
  const errorMessages = errors.length
    ? `<span class="field-error small" id="${inputId}-error">${escapeHtml(errors.join(', '))}</span>`
    : '';
  if (errors.length) describedIds.push(`${inputId}-error`);
  const invalidAttr = `${errors.length ? ' aria-invalid="true"' : ''}${describedIds.length ? ` aria-describedby="${describedIds.join(' ')}"` : ''}`;
  if (field.type === 'boolean') {
    const checked = value ? 'checked' : '';
    return `
      <label class="field checkbox">
        <input id="${inputId}" type="checkbox" name="${FIELD_PREFIX}${key}" ${checked}${invalidAttr} />
        <span>${label}${field.required ? ' (required)' : ''}</span>
        ${description}
        ${errorMessages}
      </label>
    `;
  }
  const inputType = resolveInputType(field.type);
  const inputValue = value === undefined || value === null ? '' : String(value);
  return `
    <label class="field">
      <span>${label}${field.required ? ' (required)' : ''}</span>
      <input id="${inputId}" name="${FIELD_PREFIX}${key}" type="${inputType}" value="${escapeHtml(inputValue)}" ${required}${invalidAttr} />
      ${description}
      ${errorMessages}
    </label>
  `;
}

function resolveInputType(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'email') return 'email';
  if (normalized === 'phone') return 'tel';
  if (normalized === 'number') return 'number';
  return 'text';
}

function renderErrors(errors = []) {
  return renderFormErrors(errors, { id: 'profile-attributes-error', title: 'Fields not saved' });
}

function splitProfileErrors(errors = [], providerFields = []) {
  const fieldErrors = {};
  const formErrors = [];
  const fieldKeys = new Set(providerFields.map((field) => field.key).filter(Boolean));
  for (const rawError of errors || []) {
    const message = String(rawError || '').trim();
    if (!message) continue;
    const lower = message.toLowerCase();
    if (lower.startsWith('missing required fields:')) {
      const tail = message.split(':').slice(1).join(':');
      const missing = tail
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      let matched = false;
      for (const key of missing) {
        if (!fieldKeys.has(key)) continue;
        fieldErrors[key] = [...(fieldErrors[key] || []), 'Required field'];
        matched = true;
      }
      if (!matched) {
        formErrors.push(message);
      }
      continue;
    }
    const separatorIndex = message.indexOf(':');
    if (separatorIndex > 0) {
      const key = message.slice(0, separatorIndex).trim();
      const detail = message.slice(separatorIndex + 1).trim() || 'Invalid value';
      if (fieldKeys.has(key)) {
        fieldErrors[key] = [...(fieldErrors[key] || []), detail];
        continue;
      }
    }
    formErrors.push(message);
  }
  return { formErrors, fieldErrors };
}
