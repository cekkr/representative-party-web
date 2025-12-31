import { escapeHtml } from '../../../shared/utils/text.js';

export function renderDiscussionList(entries) {
  if (!entries.length) {
    return '<p class="muted">No contributions yet. Be the first to start the debate.</p>';
  }

  return entries
    .map((entry) => {
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(entry.topic)}</span>
            <span class="pill ghost">${escapeHtml(entry.stance)}</span>
            ${entry.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(entry)}
            <span class="muted small">${new Date(entry.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(entry.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(entry.authorHash)}</p>
        </article>
      `;
    })
    .join('\n');
}

function renderIssuerPill(entry) {
  const issuer = entry?.issuer || entry?.provenance?.issuer;
  if (!issuer) return '';
  return `<span class="pill ghost">from ${escapeHtml(String(issuer))}</span>`;
}
