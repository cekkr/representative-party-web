import { escapeHtml } from '../../../shared/utils/text.js';

// Inline form feedback shared by settings-style pages. A confirmation is a
// polite live region next to the form it confirms; a rejection is an alert
// with an id so the offending control can point at it via aria-describedby.
// Both render as ordinary HTML, so the ordinary POST → re-render flow and the
// enhanced partial swap announce the same message.

export function renderFormNotice(message, { id } = {}) {
  const text = String(message || '').trim();
  if (!text) return '';
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  return `<p class="form-notice" role="status"${idAttr}>${escapeHtml(text)}</p>`;
}

export function renderFormErrors(errors = [], { id, title = 'Please fix the following' } = {}) {
  const items = (errors || []).map((error) => String(error || '').trim()).filter(Boolean);
  if (!items.length) return '';
  const idAttr = id ? ` id="${escapeHtml(id)}"` : '';
  const list = items.length === 1
    ? `<p class="small">${escapeHtml(items[0])}</p>`
    : `<ul class="plain small">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  return `
    <div class="callout is-warning form-errors" role="alert"${idAttr}>
      <strong class="small">${escapeHtml(title)}</strong>
      ${list}
    </div>`;
}
