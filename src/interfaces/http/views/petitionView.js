import { escapeHtml } from '../../../shared/utils/text.js';

export function renderPetitionList(
  petitions,
  votes,
  signatures,
  person,
  canModerate,
  commentsByPetition = new Map(),
  options = {},
) {
  const allowDelegation = options.allowDelegation !== false;
  const allowVoting = options.allowVoting !== false;
  if (!petitions.length) {
    return '<p class="muted">No proposals yet. Draft the first one.</p>';
  }

  const voteBuckets = buildVoteBuckets(votes);

  return petitions
    .map((petition) => {
      const statusLabel = displayStatus(petition.status);
      const tally = voteBuckets.get(petition.id) || { yes: 0, no: 0, abstain: 0 };
      const stageAllowsVoting = isVotingStage(petition.status);
      const voteDisabled = !stageAllowsVoting || !allowVoting;
      const voteDisabledLabel = allowVoting
        ? 'Voting disabled while proposal is not in the vote stage.'
        : 'Voting module disabled.';
      const signatureCount = (signatures || []).filter((s) => s.petitionId === petition.id).length;
      const hasSigned = person?.pidHash ? (signatures || []).some((s) => s.petitionId === petition.id && s.authorHash === person.pidHash) : false;
      const comments = commentsByPetition.get(petition.id) || [];
      const lastCommentAt = getLastCommentAt(comments);
      const anchorId = `petition-${petition.id}`;
      return `
        <article class="discussion" id="${escapeHtml(anchorId)}">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(statusLabel)}</span>
            ${petition.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${new Date(petition.createdAt).toLocaleString()}</span>
            <span class="pill ghost">Topic: ${escapeHtml(petition.topic || 'general')}</span>
            <span class="pill">Quorum: ${petition.quorum || 0}</span>
            <span class="pill ghost">Signatures: ${signatureCount}</span>
            <span class="pill ghost">Discussion: ${comments.length}</span>
            ${lastCommentAt ? `<span class="muted small">Last comment ${lastCommentAt}</span>` : ''}
            <a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Permalink</a>
          </div>
          <h3>${escapeHtml(petition.title)}</h3>
          <p>${escapeHtml(petition.summary)}</p>
          ${renderProposalText(petition.body)}
          <p class="muted small">Author hash: ${escapeHtml(petition.authorHash || 'anonymous')}</p>
          <p class="muted small">Votes — yes: ${tally.yes} · no: ${tally.no} · abstain: ${tally.abstain}</p>
          ${
            hasSigned
              ? '<p class="muted small">You already signed.</p>'
              : `
          <form class="form-inline" method="post" action="/petitions/sign" data-enhance="petitions">
            <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
            <button type="submit" class="ghost">Sign proposal</button>
          </form>
          `
          }
          ${
            voteDisabled
              ? `<p class="muted small">${voteDisabledLabel}</p>`
              : `
          <form class="form-inline" method="post" action="/petitions/vote" data-enhance="petitions">
            <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
            <select name="choice">
              <option value="yes">yes</option>
              <option value="no">no</option>
              <option value="abstain" selected>abstain</option>
              ${allowDelegation ? '<option value="auto">auto (use delegation)</option>' : ''}
            </select>
            <button type="submit" class="ghost">Vote</button>
          </form>
          `
          }
          ${renderDiscussionBlock(petition, comments)}
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
  const status = petition.status === 'open' ? 'vote' : petition.status;
  return `
    <form class="form-inline" method="post" action="/petitions/status" data-enhance="petitions">
      <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
      <label>Status
        <select name="status">
          <option value="draft" ${status === 'draft' ? 'selected' : ''}>draft</option>
          <option value="discussion" ${status === 'discussion' ? 'selected' : ''}>discussion</option>
          <option value="vote" ${status === 'vote' ? 'selected' : ''}>vote</option>
          <option value="closed" ${status === 'closed' ? 'selected' : ''}>closed</option>
        </select>
      </label>
      <label>Quorum <input name="quorum" value="${petition.quorum || 0}" size="4" /></label>
      <button type="submit" class="ghost">Apply</button>
    </form>
  `;
}

function renderProposalText(text) {
  if (!text) return '';
  return `
    <details class="note">
      <summary>Proposal text</summary>
      <pre>${escapeHtml(text)}</pre>
    </details>
  `;
}

function renderDiscussionBlock(petition, comments) {
  const count = comments.length;
  const disabled = petition.status === 'closed';
  const discussionList = renderPetitionComments(comments);
  return `
    <details class="note">
      <summary>Discussion (${count})</summary>
      ${
        disabled
          ? '<p class="muted small">Discussion closed.</p>'
          : `
      <form class="stack" method="post" action="/petitions/comment" data-enhance="petitions">
        <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
        <label class="field">
          <span>Comment</span>
          <textarea name="content" rows="2" placeholder="Add a discussion note" required></textarea>
        </label>
        <button class="ghost" type="submit">Post comment</button>
      </form>
      `
      }
      <div class="discussion-list">
        ${discussionList}
      </div>
    </details>
  `;
}

function renderPetitionComments(comments) {
  if (!comments.length) {
    return '<p class="muted small">No discussion notes yet.</p>';
  }
  return comments
    .map((comment) => {
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill ghost">Comment</span>
            ${comment.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${new Date(comment.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(comment.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(comment.authorHash || 'anonymous')}</p>
        </article>
      `;
    })
    .join('\n');
}

export function renderProposalDiscussionFeed(items) {
  if (!items.length) {
    return '<p class="muted">No proposal discussions yet. Join a discussion to surface activity.</p>';
  }
  return items
    .map(({ comment, petition }) => {
      const statusLabel = displayStatus(petition?.status || 'draft');
      const snippet = (comment.content || '').slice(0, 180);
      const anchorId = petition?.id ? `petition-${petition.id}` : null;
      const permalink = anchorId ? `<a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Open proposal</a>` : '';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(statusLabel)}</span>
            <span class="pill ghost">Proposal</span>
            ${comment.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${new Date(comment.createdAt).toLocaleString()}</span>
            ${permalink}
          </div>
          <p class="muted small">${escapeHtml(petition?.title || 'Proposal')}</p>
          <p>${escapeHtml(snippet)}</p>
          <p class="muted small">Comment by ${escapeHtml(comment.authorHash || 'anonymous')}</p>
        </article>
      `;
    })
    .join('\n');
}

function displayStatus(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'open') return 'vote';
  return normalized || 'draft';
}

function isVotingStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'open' || normalized === 'vote';
}

function getLastCommentAt(comments) {
  if (!comments.length) return '';
  let latest = 0;
  for (const comment of comments) {
    const time = Date.parse(comment.createdAt || '');
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
    }
  }
  return latest ? new Date(latest).toLocaleString() : '';
}
