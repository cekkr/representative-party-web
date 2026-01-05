import { escapeHtml } from '../../../shared/utils/text.js';
import {
  getCommentStanceLabel,
  listCommentStances,
  normalizeCommentStance,
} from '../../../modules/petitions/commentStance.js';
import { renderIssuerPill, resolveTopicBreadcrumb } from './shared.js';

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
  const signatureBuckets = buildSignatureBuckets(signatures || [], person);

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
      const signatureSummary = signatureBuckets.get(petition.id) || { count: 0, signed: false };
      const signatureCount = signatureSummary.count;
      const hasSigned = signatureSummary.signed;
      const comments = commentsByPetition.get(petition.id) || [];
      const lastCommentAt = getLastCommentAt(comments);
      const revisions = Array.isArray(petition.versions) ? petition.versions : [];
      const anchorId = `petition-${petition.id}`;
      const proposalText = petition.freeze?.body ?? petition.body;
      const evidenceSummary = petition.freeze?.evidenceSummary ?? petition.evidenceSummary;
      const evidenceLinks = Array.isArray(petition.freeze?.evidenceLinks)
        ? petition.freeze.evidenceLinks
        : Array.isArray(petition.evidenceLinks)
          ? petition.evidenceLinks
          : [];
      const freezeNotice = renderFreezeNotice(petition);
      const reviewPrompt = renderReviewPrompt(petition, revisions);
      const evidenceBlock = renderEvidenceBlock(evidenceSummary, evidenceLinks);
      const evidencePill = evidenceBlock ? '<span class="pill ghost">Evidence</span>' : '';
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
            ${petition.freeze ? '<span class="pill">Frozen</span>' : ''}
            ${evidencePill}
            ${lastCommentAt ? `<span class="muted small">Last comment ${lastCommentAt}</span>` : ''}
            <a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Permalink</a>
          </div>
          ${renderStageTimeline(petition)}
          ${reviewPrompt}
          ${freezeNotice}
          <h3>${escapeHtml(petition.title)}</h3>
          <p>${escapeHtml(petition.summary)}</p>
          ${evidenceBlock}
          ${renderProposalText(proposalText, petition.freeze ? 'Frozen proposal text' : 'Proposal text')}
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


function buildVoteBuckets(votes) {
  const buckets = new Map();
  for (const vote of votes || []) {
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

function buildSignatureBuckets(signatures = [], person) {
  const buckets = new Map();
  const signerHash = person?.pidHash || '';
  for (const signature of signatures) {
    if (!signature?.petitionId) continue;
    let summary = buckets.get(signature.petitionId);
    if (!summary) {
      summary = { count: 0, signed: false };
      buckets.set(signature.petitionId, summary);
    }
    summary.count += 1;
    if (signerHash && signature.authorHash === signerHash) {
      summary.signed = true;
    }
  }
  return buckets;
}

function renderModerationForm(petition) {
  const status = petition.status === 'open' ? 'vote' : petition.status;
  const frozenAt = petition.freeze?.frozenAt ? new Date(petition.freeze.frozenAt).toLocaleString() : '';
  const frozenBy = petition.freeze?.frozenBy || '';
  const freezeNote = frozenAt ? `<p class="muted small">Frozen at ${escapeHtml(frozenAt)} ${frozenBy ? `by ${escapeHtml(frozenBy)}` : ''}.</p>` : '';
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
      <label class="field checkbox">
        <input type="checkbox" name="confirmFreeze" value="yes" />
        <span>Confirm freeze before opening vote</span>
      </label>
      <button type="submit" class="ghost">Apply</button>
    </form>
    ${freezeNote}
  `;
}

function renderProposalText(text, label = 'Proposal text') {
  if (!text) return '';
  return `
    <details class="note">
      <summary>${escapeHtml(label)}</summary>
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
    return '<p class="muted small">Draft editing closes once the vote stage opens. Review the frozen text before voting.</p>';
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
          <span>Evidence summary (optional)</span>
          <textarea name="evidenceSummary" rows="3">${escapeHtml(petition.evidenceSummary || '')}</textarea>
        </label>
        <label class="field">
          <span>Evidence links (optional, one per line)</span>
          <textarea name="evidenceLinks" rows="3">${escapeHtml(formatEvidenceLinks(petition.evidenceLinks || []))}</textarea>
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
    .map((revision, index) => {
      const previous = versions[index + 1];
      const when = revision.createdAt ? new Date(revision.createdAt).toLocaleString() : '';
      const author = String(revision.authorHandle || revision.authorHash || 'anonymous');
      const note = revision.note ? `<div class="muted small">${escapeHtml(String(revision.note))}</div>` : '';
      const topicLabel = resolveTopicBreadcrumb(revision, state);
      const diffBlock = renderRevisionDiff(revision, previous, state);
      return `
        <li>
          <div class="muted small">${escapeHtml(when)} · ${escapeHtml(author)} · Topic: ${escapeHtml(topicLabel)}</div>
          <div>${escapeHtml(revision.title || petition.title || 'Untitled')}</div>
          ${note}
          ${diffBlock}
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
  const stanceSummary = renderCommentStanceSummary(comments);
  return `
    <details class="note">
      <summary>Discussion (${count})</summary>
      ${stanceSummary ? `<p class="muted small">${escapeHtml(stanceSummary)}</p>` : ''}
      ${
        disabled
          ? '<p class="muted small">Discussion closed.</p>'
          : `
      <form class="stack" method="post" action="/petitions/comment" data-enhance="petitions">
        <input type="hidden" name="petitionId" value="${escapeHtml(petition.id)}" />
        <label class="field">
          <span>Comment type</span>
          <select name="stance">
            ${renderCommentStanceOptions('comment')}
          </select>
        </label>
        <label class="field">
          <span>Comment</span>
          <textarea name="content" rows="2" placeholder="Add a discussion note" required></textarea>
        </label>
        <label class="field checkbox">
          <input type="checkbox" name="factCheck" value="yes" />
          <span>Request fact check for this comment</span>
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
      const stanceLabel = getCommentStanceLabel(comment.stance);
      const stancePill = `<span class="pill ghost">${escapeHtml(stanceLabel)}</span>`;
      const factCheckPill = comment.factCheck ? '<span class="pill warning">Fact check</span>' : '';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            ${stancePill}
            ${factCheckPill}
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
      const stanceLabel = getCommentStanceLabel(comment.stance);
      const stancePill = `<span class="pill ghost">${escapeHtml(stanceLabel)}</span>`;
      const factCheckPill = comment.factCheck ? '<span class="pill warning">Fact check</span>' : '';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(statusLabel)}</span>
            <span class="pill ghost">Proposal</span>
            ${stancePill}
            ${factCheckPill}
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

function renderCommentStanceOptions(selected = 'comment') {
  const normalized = normalizeCommentStance(selected);
  return listCommentStances()
    .map((entry) => {
      const isSelected = entry.value === normalized ? 'selected' : '';
      return `<option value="${escapeHtml(entry.value)}" ${isSelected}>${escapeHtml(entry.label)}</option>`;
    })
    .join('');
}

function renderCommentStanceSummary(comments) {
  if (!comments.length) return '';
  const counts = { support: 0, concern: 0, question: 0, comment: 0 };
  for (const comment of comments) {
    const key = normalizeCommentStance(comment?.stance);
    if (counts[key] !== undefined) {
      counts[key] += 1;
    }
  }
  const parts = [];
  if (counts.support) parts.push(`Support ${counts.support}`);
  if (counts.concern) parts.push(`Concern ${counts.concern}`);
  if (counts.question) parts.push(`Question ${counts.question}`);
  if (counts.comment) parts.push(`Notes ${counts.comment}`);
  return parts.join(' · ');
}

function renderUpdatedMeta(petition) {
  const updatedAt = petition.updatedAt || '';
  if (!updatedAt) return '';
  if (petition.createdAt && petition.createdAt === updatedAt && !petition.updatedBy) return '';
  const label = new Date(updatedAt).toLocaleString();
  const author = petition.updatedBy ? ` by ${petition.updatedBy}` : '';
  return `<span class="muted small">Updated ${escapeHtml(label)}${escapeHtml(author)}</span>`;
}


function renderFreezeNotice(petition) {
  if (!petition?.freeze) return '';
  const frozenAt = petition.freeze.frozenAt ? new Date(petition.freeze.frozenAt).toLocaleString() : '';
  const frozenBy = petition.freeze.frozenBy ? `by ${petition.freeze.frozenBy}` : '';
  const revisionId = petition.freeze.revisionId ? petition.freeze.revisionId.slice(0, 8) : '';
  const revisionLine = revisionId ? `<p class="muted small">Revision: ${escapeHtml(revisionId)}</p>` : '';
  return `
    <div class="callout">
      <p class="muted small">Draft frozen for voting ${frozenAt ? `at ${escapeHtml(frozenAt)}` : ''} ${escapeHtml(frozenBy)}.</p>
      ${revisionLine}
      <p class="muted small">Votes are recorded against the frozen text.</p>
    </div>
  `;
}

function renderReviewPrompt(petition, revisions) {
  if (!petition) return '';
  if (normalizeStage(petition.status) !== 'discussion') return '';
  if (!Array.isArray(revisions) || revisions.length < 2) return '';
  return `
    <p class="muted small">Review the latest revision diff before moving this proposal to a vote.</p>
  `;
}

function renderRevisionDiff(revision, previous, state) {
  if (!previous) {
    return '<p class="muted small">Initial draft.</p>';
  }
  const changes = [];
  if ((revision.title || '') !== (previous.title || '')) {
    changes.push({ label: 'Title', before: previous.title, after: revision.title });
  }
  if ((revision.summary || '') !== (previous.summary || '')) {
    changes.push({ label: 'Summary', before: previous.summary, after: revision.summary });
  }
  if ((revision.body || '') !== (previous.body || '')) {
    changes.push({ label: 'Body', before: previous.body, after: revision.body });
  }
  if ((revision.evidenceSummary || '') !== (previous.evidenceSummary || '')) {
    changes.push({ label: 'Evidence summary', before: previous.evidenceSummary, after: revision.evidenceSummary });
  }
  if (formatEvidenceLinks(revision.evidenceLinks) !== formatEvidenceLinks(previous.evidenceLinks)) {
    changes.push({
      label: 'Evidence links',
      before: formatEvidenceLinks(previous.evidenceLinks),
      after: formatEvidenceLinks(revision.evidenceLinks),
    });
  }
  const topicBefore = resolveTopicBreadcrumb(previous, state);
  const topicAfter = resolveTopicBreadcrumb(revision, state);
  if (topicBefore !== topicAfter) {
    changes.push({ label: 'Topic', before: topicBefore, after: topicAfter });
  }
  if (!changes.length) {
    return '<p class="muted small">No changes recorded.</p>';
  }
  const lines = changes
    .map((change) => {
      const before = formatDiffValue(change.before);
      const after = formatDiffValue(change.after);
      return `- ${change.label}: ${before}\n+ ${change.label}: ${after}`;
    })
    .join('\n');
  return `
    <details class="note">
      <summary>Diff vs previous revision</summary>
      <pre>${escapeHtml(lines)}</pre>
    </details>
  `;
}

function formatDiffValue(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return truncateText(text, 240);
}

function truncateText(text, limit = 240) {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function renderEvidenceBlock(summary, links = []) {
  const trimmed = (summary || '').trim();
  const normalizedLinks = normalizeEvidenceLinks(links);
  if (!trimmed && !normalizedLinks.length) return '';
  const summaryBlock = trimmed ? `<p class="muted small">${escapeHtml(trimmed)}</p>` : '';
  const linkItems = normalizedLinks
    .map((link) => `<li><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a></li>`)
    .join('');
  const linkBlock = normalizedLinks.length ? `<ul class="plain">${linkItems}</ul>` : '';
  return `
    <details class="note">
      <summary>Evidence and sources</summary>
      ${summaryBlock}
      ${linkBlock}
    </details>
  `;
}

function normalizeEvidenceLinks(links = []) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link) => String(link || '').trim())
    .filter((link) => link && /^https?:\/\//i.test(link))
    .slice(0, 8);
}

function formatEvidenceLinks(links = []) {
  return normalizeEvidenceLinks(links).join('\n');
}
