import { renderActorAvatar, renderActorLabel } from '../../interfaces/http/views/actorLabel.js';
import { renderEvidenceLinks, renderPager, resolveTopicBreadcrumb } from '../../interfaces/http/views/shared.js';
import { paginate, parsePage } from '../../shared/utils/pagination.js';
import { escapeHtml, sanitizeText } from '../../shared/utils/text.js';
import { formatTimestamp } from '../../shared/utils/time.js';
import { CASE_VOICE_TYPES, isCaseSource } from './cases.js';

export function buildCaseView(state, { query, canWork, draft = {}, message }) {
  const notice = message ? `<p class="callout" role="alert">${escapeHtml(message)}</p>` : '';
  if (!canWork) {
    return {
      caseDetail: notice || '<p>Sign in with permission to post to use the case workspace.</p>',
      caseQueue: '<p class="muted small">Case history is available to signed-in users with posting access.</p>',
    };
  }

  const sourceById = new Map(state.discussions.filter(isCaseSource).map((source) => [source.id, source]));
  const cases = state.organizationCases.filter((entry) => sourceById.has(entry.sourceMessageId));
  const search = sanitizeText(query.get('q'), 120);
  const term = search.toLowerCase();
  const matches = term ? cases.filter((entry) => {
    const source = sourceById.get(entry.sourceMessageId);
    return [entry.summary, entry.consequence, entry.scope.join(' / '), source.content]
      .some((value) => value.toLowerCase().includes(term));
  }) : cases;
  const pageInfo = paginate(matches, { page: parsePage(query.get('page')) });

  const caseId = query.get('case') || draft.caseId;
  const sourceId = query.get('source') || draft.sourceId;
  const source = sourceById.get(sourceId);
  const selected = caseId
    ? cases.find((entry) => entry.caseId === caseId)
    : sourceId
      ? cases.find((entry) => entry.sourceMessageId === sourceId)
      : pageInfo.items[0];

  let detail = '<h2>No case selected</h2><p>Open a discussion post and choose <strong>Open a case</strong> when the issue needs a review.</p><a class="ghost" href="/discussion" data-partial>Go to discussion</a>';
  if (selected) {
    detail = renderCase(state, selected, sourceById.get(selected.sourceMessageId), draft);
  } else if (source) {
    detail = '<h2>Open a case</h2>' + renderPromotion(state, source, draft);
  } else if ((caseId || sourceId) && !notice) {
    detail = '<p class="callout">The case or discussion post is unavailable.</p>' + detail;
  }

  return {
    caseDetail: notice + detail,
    caseQueue: renderQueue(pageInfo, selected, search),
  };
}

function renderQueue(pageInfo, selected, search) {
  const rows = pageInfo.items.map((entry) => {
    const active = entry === selected;
    const query = new URLSearchParams({ case: entry.caseId });
    if (search) query.set('q', search);
    if (pageInfo.page > 1) query.set('page', pageInfo.page);
    return `
      <a class="pressure-case${active ? ' is-active' : ''}" href="/organization?${escapeHtml(query.toString())}" ${active ? 'aria-current="true"' : ''} data-partial>
        <strong>${escapeHtml(entry.summary)}</strong>
        <span class="muted small">${caseStatus(entry)}</span>
      </a>`;
  }).join('');
  return `
    <form class="stack" method="get" action="/organization">
      <label class="field">
        <span>Search cases</span>
        <input type="search" name="q" value="${escapeHtml(search)}" maxlength="120" />
      </label>
      <div class="cta-row">
        <button class="ghost tiny" type="submit">Search</button>
        ${search ? '<a class="ghost tiny" href="/organization" data-partial>Clear search</a>' : ''}
      </div>
    </form>
    <div class="pressure-case-list">
      ${rows || `<p class="muted small">${search ? 'No cases match your search.' : 'No cases opened yet.'}</p>`}
    </div>
    ${renderPager(pageInfo, { baseHref: '/organization', query: { q: search }, label: 'cases' })}`;
}

function renderSource(state, source) {
  const date = formatTimestamp(source.createdAt);
  return `
    <article class="topic-card">
      <div class="topic-head">
        ${renderActorAvatar(state, source.authorHash)}
        <div class="topic-info">
          <div class="topic-byline">
            <span class="topic-author">${renderActorLabel(state, source.authorHash)}</span>
            ${date ? `<span class="topic-time muted small">${date}</span>` : ''}
          </div>
          <p class="topic-breadcrumbs">Source discussion / ${escapeHtml(resolveTopicBreadcrumb(source, state))}</p>
        </div>
      </div>
      <div class="topic-body">
        <p>${escapeHtml(source.content)}</p>
        ${renderEvidenceLinks(source.evidenceLinks)}
      </div>
    </article>`;
}

function renderPromotion(state, source, draft) {
  const choices = Object.entries(CASE_VOICE_TYPES).map(([key, label]) =>
    `<option value="${key}" ${draft.voiceType === key ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
  return `
    ${renderSource(state, source)}
    <form class="stack" method="post" action="/organization">
      <input type="hidden" name="intent" value="promote" />
      <input type="hidden" name="sourceId" value="${escapeHtml(source.id)}" />
      <label class="field">
        <span>Case summary</span>
        <input name="summary" maxlength="120" value="${escapeHtml(draft.summary || '')}" required />
      </label>
      <label class="field">
        <span>Voice type</span>
        <select name="voiceType" required>
          <option value="">Choose a voice type</option>
          ${choices}
        </select>
      </label>
      <label class="field">
        <span>Consequence</span>
        <textarea name="consequence" rows="3" maxlength="500" required>${escapeHtml(draft.consequence || '')}</textarea>
      </label>
      <p class="muted small">This case is visible to signed-in users with posting access on this provider.</p>
      <div class="cta-row"><button class="cta" type="submit">Open case</button></div>
    </form>`;
}

// Case record: header (summary, voice type, state, review date, who opened it),
// then the attributed source that stays canonical, then acknowledgement history.
function renderCase(state, entry, source, draft) {
  const acknowledgement = entry.acknowledgement;
  const review = entry.reviewAt ? formatTimestamp(entry.reviewAt + 'T12:00:00') : '';
  const opened = formatTimestamp(entry.createdAt);
  const acknowledged = acknowledgement ? formatTimestamp(acknowledgement.at) : '';
  return `
    <header class="case-heading stack">
      <div class="topic-meta">
        <span class="pill ${entry.state === 'acknowledged' ? 'stance stance--support' : 'stance stance--question'}">${caseStatus(entry)}</span>
        <span class="pill ghost">${escapeHtml(CASE_VOICE_TYPES[entry.voiceType])}</span>
        ${review ? `<span class="pill ghost">Review on ${review}</span>` : ''}
      </div>
      <h2 id="case-title">${escapeHtml(entry.summary)}</h2>
      <p class="muted small">Opened by ${renderActorLabel(state, entry.createdBy)}${opened ? ` · <time datetime="${escapeHtml(entry.createdAt)}">${opened}</time>` : ''}</p>
      <p>${escapeHtml(entry.consequence)}</p>
    </header>
    <section class="stack" aria-labelledby="case-source-title">
      <h3 id="case-source-title">Original message</h3>
      ${renderSource(state, source)}
    </section>
    <section class="stack" aria-labelledby="case-history-title">
      <h3 id="case-history-title">Acknowledgement</h3>
      ${acknowledgement ? `
        <ol class="case-history">
          <li>
            <p class="small"><strong>Opened</strong> by ${renderActorLabel(state, entry.createdBy, { showHash: false })}${opened ? ` · <time datetime="${escapeHtml(entry.createdAt)}">${opened}</time>` : ''}</p>
          </li>
          <li>
            <p class="small"><strong>Acknowledged</strong> by ${renderActorLabel(state, acknowledgement.actorHash)}${acknowledged ? ` · <time datetime="${escapeHtml(acknowledgement.at)}">${acknowledged}</time>` : ''}</p>
            <p>${escapeHtml(acknowledgement.note)}</p>
            ${review ? `<p class="muted small">Review on ${review}</p>` : ''}
          </li>
        </ol>` : `
        <p class="muted small">No one has acknowledged this case yet. Record receipt and when to revisit it. Assigning an owner is a separate step.</p>
        <form class="stack" method="post" action="/organization">
          <input type="hidden" name="intent" value="acknowledge" />
          <input type="hidden" name="caseId" value="${escapeHtml(entry.caseId)}" />
          <label class="field">
            <span>Acknowledgement</span>
            <textarea name="note" rows="3" maxlength="500" required>${escapeHtml(draft.note || '')}</textarea>
          </label>
          <label class="field">
            <span>Review date</span>
            <input type="date" name="reviewAt" value="${escapeHtml(draft.reviewAt || '')}" required />
          </label>
          <div class="cta-row"><button class="cta" type="submit">Acknowledge case</button></div>
        </form>`}
    </section>`;
}

function caseStatus(entry) {
  return entry.state === 'acknowledged' ? 'Acknowledged' : 'Awaiting acknowledgement';
}
