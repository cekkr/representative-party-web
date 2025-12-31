import { formatTopicBreadcrumb as formatTopicBreadcrumbFromRegistry } from '../../../modules/topics/registry.js';
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
  const allowEditing = options.allowEditing === true;
  const editGate = options.editGate || {};
  const actorLabels = options.actorLabels || {};
  const actorLabelPlural = actorLabels.actorLabelPlural || 'users';
  const state = options.state;
  if (!petitions.length) {
    return '<p class="muted">No proposals yet. Draft the first one.</p>';
  }

  const voteBuckets = buildVoteBuckets(votes);

  return petitions
    .map((petition) => {
      const topicLabel = resolveTopicBreadcrumb(petition, state);
      const statusLabel = displayStatus(petition.status);
      const tally = voteBuckets.get(petition.id) || { yes: 0, no: 0, abstain: 0 };
      const stageAllowsVoting = isVotingStage(petition.status);
      const stageAllowsEditing = isEditableStage(petition.status);
      const canEdit = allowEditing && stageAllowsEditing;
      const voteDisabled = !stageAllowsVoting || !allowVoting;
      const voteDisabledLabel = allowVoting
        ? 'Voting disabled while proposal is not in the vote stage.'
        : 'Voting module disabled.';
      const signatureCount = (signatures || []).filter((s) => s.petitionId === petition.id).length;
      const hasSigned = person?.pidHash ? (signatures || []).some((s) => s.petitionId === petition.id && s.authorHash === person.pidHash) : false;
      const comments = commentsByPetition.get(petition.id) || [];
      const lastCommentAt = getLastCommentAt(comments);
      const revisions = Array.isArray(petition.versions) ? petition.versions : [];
      const anchorId = `petition-${petition.id}`;
      return `
        <article class="discussion" id="${escapeHtml(anchorId)}">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(statusLabel)}</span>
            ${petition.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            ${renderIssuerPill(petition)}
            <span class="muted small">${new Date(petition.createdAt).toLocaleString()}</span>
            ${renderUpdatedMeta(petition)}
            <span class="pill ghost">Topic: ${escapeHtml(topicLabel)}</span>
            <span class="pill">Quorum: ${petition.quorum || 0}</span>
            <span class="pill ghost">Signatures: ${signatureCount}</span>
            <span class="pill ghost">Discussion: ${comments.length}</span>
            <span class="pill ghost">Revisions: ${revisions.length}</span>
            ${lastCommentAt ? `<span class="muted small">Last comment ${lastCommentAt}</span>` : ''}
            <a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Permalink</a>
          </div>
          ${renderStageTimeline(petition)}
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
          ${renderDraftUpdateForm(petition, {
            canEdit,
            allowEditing,
            editGate,
            actorLabelPlural,
          })}
          ${renderRevisionHistory(petition, state)}
          ${canModerate ? renderModerationForm(petition) : ''}
        </article>
      `;
    })
    .join('\n');
}

function resolveTopicBreadcrumb(entry, state) {
  if (entry?.topicId && state) {
    const live = formatTopicBreadcrumbFromRegistry(state, entry.topicId);
    if (live) return live;
  }
  if (Array.isArray(entry?.topicPath) && entry.topicPath.length) {
    return entry.topicPath.join(' / ');
  }
  if (entry?.topicBreadcrumb) return entry.topicBreadcrumb;
  return entry?.topic || 'general';
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

function renderStageTimeline(petition) {
  const stage = normalizeStage(petition.status);
  const stages = ['draft', 'discussion', 'vote', 'closed'];
  const pills = stages
    .map((entry) => {
      const label = formatStageLabel(entry);
      const klass = stage === entry ? 'pill' : 'pill ghost';
      return `<span class="${klass}">${escapeHtml(label)}</span>`;
    })
    .join('');
  return `
    <div class="discussion__meta">
      <span class="pill ghost">Stage</span>
      ${pills}
    </div>
  `;
}

function renderDraftUpdateForm(petition, { canEdit, allowEditing, editGate, actorLabelPlural } = {}) {
  if (!allowEditing) {
    return '';
  }
  if (!canEdit) {
    return '<p class="muted small">Draft editing closes once the vote stage opens.</p>';
  }
  const gateMessage = editGate?.allowed ? '' : editGate?.message || editGate?.reason || '';
  const gateNotice = gateMessage ? `<p class="muted small">${escapeHtml(gateMessage)}</p>` : '';
  return `
    <details class="note">
      <summary>Update draft (collaborative)</summary>
      <p class="muted small">Verified ${escapeHtml(actorLabelPlural)} can refine this proposal while it is in draft or discussion.</p>
      ${gateNotice}
      <form class="stack" method="post" action="/petitions/update" data-enhance="petitions">
        <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
        <label class="field">
          <span>Title</span>
          <input name="title" value="${escapeHtml(petition.title || '')}" required />
        </label>
        <label class="field">
          <span>Summary</span>
          <textarea name="summary" rows="3" required>${escapeHtml(petition.summary || '')}</textarea>
        </label>
        <label class="field">
          <span>Proposal text (optional)</span>
          <textarea name="body" rows="6">${escapeHtml(petition.body || '')}</textarea>
        </label>
        <label class="field">
          <span>Revision note (optional)</span>
          <input name="note" placeholder="What changed?" />
        </label>
        <button type="submit" class="ghost">Save revision</button>
      </form>
    </details>
  `;
}

function renderRevisionHistory(petition, state) {
  const versions = Array.isArray(petition.versions) ? petition.versions : [];
  if (!versions.length) return '';
  const items = versions
    .map((revision) => {
      const when = revision.createdAt ? new Date(revision.createdAt).toLocaleString() : '';
      const author = String(revision.authorHandle || revision.authorHash || 'anonymous');
      const note = revision.note ? `<div class="muted small">${escapeHtml(String(revision.note))}</div>` : '';
      const topicLabel = resolveTopicBreadcrumb(revision, state);
      return `
        <li>
          <div class="muted small">${escapeHtml(when)} · ${escapeHtml(author)} · Topic: ${escapeHtml(topicLabel)}</div>
          <div>${escapeHtml(revision.title || petition.title || 'Untitled')}</div>
          ${note}
        </li>
      `;
    })
    .join('');
  return `
    <details class="note">
      <summary>Version history (${versions.length})</summary>
      <ul class="plain">
        ${items}
      </ul>
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
            ${renderIssuerPill(comment)}
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
            ${renderIssuerPill(comment)}
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

function isEditableStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'draft' || normalized === 'discussion';
}

function normalizeStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'open') return 'vote';
  if (normalized === 'vote') return 'vote';
  if (normalized === 'discussion') return 'discussion';
  if (normalized === 'closed') return 'closed';
  return 'draft';
}

function formatStageLabel(stage) {
  if (!stage) return '';
  return stage.charAt(0).toUpperCase() + stage.slice(1);
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

function renderUpdatedMeta(petition) {
  const updatedAt = petition.updatedAt || '';
  if (!updatedAt) return '';
  if (petition.createdAt && petition.createdAt === updatedAt && !petition.updatedBy) return '';
  const label = new Date(updatedAt).toLocaleString();
  const author = petition.updatedBy ? ` by ${petition.updatedBy}` : '';
  return `<span class="muted small">Updated ${escapeHtml(label)}${escapeHtml(author)}</span>`;
}

function renderIssuerPill(entry) {
  const issuer = entry?.issuer || entry?.provenance?.issuer;
  if (!issuer) return '';
  return `<span class="pill ghost">from ${escapeHtml(String(issuer))}</span>`;
}
