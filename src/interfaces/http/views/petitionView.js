import { escapeHtml } from '../../shared/utils/text.js';

export function renderPetitionList(petitions, votes, signatures, person, canModerate) {
  if (!petitions.length) {
    return '<p class="muted">No petitions yet. Draft the first one.</p>';
  }

  const voteBuckets = buildVoteBuckets(votes);

  return petitions
    .map((petition) => {
      const tally = voteBuckets.get(petition.id) || { yes: 0, no: 0, abstain: 0 };
      const voteDisabled = petition.status !== 'open';
      const signatureCount = (signatures || []).filter((s) => s.petitionId === petition.id).length;
      const hasSigned = person?.pidHash ? (signatures || []).some((s) => s.petitionId === petition.id && s.authorHash === person.pidHash) : false;
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(petition.status || 'draft')}</span>
            ${petition.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${new Date(petition.createdAt).toLocaleString()}</span>
            <span class="pill ghost">Topic: ${escapeHtml(petition.topic || 'general')}</span>
            <span class="pill">Quorum: ${petition.quorum || 0}</span>
            <span class="pill ghost">Signatures: ${signatureCount}</span>
          </div>
          <h3>${escapeHtml(petition.title)}</h3>
          <p>${escapeHtml(petition.summary)}</p>
          <p class="muted small">Author hash: ${escapeHtml(petition.authorHash || 'anonymous')}</p>
          <p class="muted small">Votes — yes: ${tally.yes} · no: ${tally.no} · abstain: ${tally.abstain}</p>
          ${
            hasSigned
              ? '<p class="muted small">You already signed.</p>'
              : `
          <form class="form-inline" method="post" action="/petitions/sign" data-enhance="petitions">
            <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
            <button type="submit" class="ghost">Sign petition</button>
          </form>
          `
          }
          ${
            voteDisabled
              ? '<p class="muted small">Voting disabled while petition is not open.</p>'
              : `
          <form class="form-inline" method="post" action="/petitions/vote" data-enhance="petitions">
            <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
            <select name="choice">
              <option value="yes">yes</option>
              <option value="no">no</option>
              <option value="abstain" selected>abstain</option>
              <option value="auto">auto (use delegation)</option>
            </select>
            <button type="submit" class="ghost">Vote</button>
          </form>
          `
          }
          ${canModerate ? renderModerationForm(petition) : ''}
        </article>
      `;
    })
    .join('\n');
}

function buildVoteBuckets(votes) {
  const buckets = new Map();
  for (const vote of votes) {
    const key = vote.petitionId;
    if (!buckets.has(key)) {
      buckets.set(key, { yes: 0, no: 0, abstain: 0 });
    }
    const tally = buckets.get(key);
    const choice = (vote.choice || 'abstain').toLowerCase();
    if (choice === 'yes') tally.yes += 1;
    else if (choice === 'no') tally.no += 1;
    else tally.abstain += 1;
  }
  return buckets;
}

function renderModerationForm(petition) {
  return `
    <form class="form-inline" method="post" action="/petitions/status" data-enhance="petitions">
      <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
      <label>Status
        <select name="status">
          <option value="draft" ${petition.status === 'draft' ? 'selected' : ''}>draft</option>
          <option value="open" ${petition.status === 'open' ? 'selected' : ''}>open</option>
          <option value="closed" ${petition.status === 'closed' ? 'selected' : ''}>closed</option>
        </select>
      </label>
      <label>Quorum <input name="quorum" value="${petition.quorum || 0}" size="4" /></label>
      <button type="submit" class="ghost">Apply</button>
    </form>
  `;
}
