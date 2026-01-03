import { escapeHtml } from '../../../shared/utils/text.js';

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
    <form class="stack" method="post" action="/profile" data-enhance="profile">
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
    <p class="muted small">Leaving optional fields blank clears them. Values never gossip to peers.</p>
    <p class="muted small">Only verified ${escapeHtml(actorLabels?.actorLabelPlural || 'users')} can edit profile attributes.</p>
  `;
}

export function renderProfileSummary(person, actorLabels) {
  if (!person) {
    return `
      <div class="callout">
        <p class="muted small">No verified session found for this browser.</p>
      </div>
    `;
  }
  return `
    <div class="callout">
      <p class="muted small">Handle: ${escapeHtml(person.handle || 'unknown')}</p>
      <p class="muted small">Role: ${escapeHtml(person.role || actorLabels?.actorLabel || 'user')}</p>
      <p class="muted small">Verified hash: ${escapeHtml(person.pidHash || 'unavailable')}</p>
    </div>
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
  const description = field.description ? `<span class="muted small">${escapeHtml(field.description)}</span>` : '';
  const errorMessages = errors.length ? `<span class="muted small">${escapeHtml(errors.join(', '))}</span>` : '';
  const invalidAttr = errors.length ? ' aria-invalid="true"' : '';
  if (field.type === 'boolean') {
    const checked = value ? 'checked' : '';
    return `
      <label class="field checkbox">
        <input type="checkbox" name="${FIELD_PREFIX}${key}" ${checked}${invalidAttr} />
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
      <input name="${FIELD_PREFIX}${key}" type="${inputType}" value="${escapeHtml(inputValue)}" ${required}${invalidAttr} />
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
  if (!errors.length) return '';
  const items = errors.map((error) => `<li>${escapeHtml(String(error))}</li>`).join('');
  return `
    <div class="callout">
      <p class="muted small">Profile validation</p>
      <ul class="plain">${items}</ul>
    </div>
  `;
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
