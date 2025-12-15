import { escapeHtml } from '../utils/text.js';

export function renderPetitionList(petitions, votes) {
  if (!petitions.length) {
    return '<p class="muted">No petitions yet. Draft the first one.</p>';
  }

  const voteBuckets = buildVoteBuckets(votes);

  return petitions
    .map((petition) => {
      const tally = voteBuckets.get(petition.id) || { yes: 0, no: 0, abstain: 0 };
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(petition.status || 'draft')}</span>
            <span class="muted small">${new Date(petition.createdAt).toLocaleString()}</span>
          </div>
          <h3>${escapeHtml(petition.title)}</h3>
          <p>${escapeHtml(petition.summary)}</p>
          <p class="muted small">Author hash: ${escapeHtml(petition.authorHash || 'anonymous')}</p>
          <p class="muted small">Votes — yes: ${tally.yes} · no: ${tally.no} · abstain: ${tally.abstain}</p>
          <form class="form-inline" method="post" action="/petitions/vote" data-enhance="petitions">
            <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
            <select name="choice">
              <option value="yes">yes</option>
              <option value="no">no</option>
              <option value="abstain" selected>abstain</option>
            </select>
            <button type="submit" class="ghost">Vote</button>
          </form>
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
