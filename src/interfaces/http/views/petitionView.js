import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import {
  getCommentStanceLabel,
  listCommentStances,
  normalizeCommentStance,
} from '../../../modules/petitions/commentStance.js';
import {
  renderAuthorHashLine,
  renderEmptyState,
  renderEvidenceLinks,
  renderIssuerPill,
  renderPreviewPill,
  renderPromotionRequestControls,
  resolveTopicBreadcrumb,
} from './shared.js';
import { renderActorAvatar, renderActorLabel, resolveHandleForHash } from './actorLabel.js';
import {
  buildPetitionVoteIndex,
  resolveVoteChoice,
  tallyVotes,
} from '../../../modules/delegation/delegatedBallots.js';
import { describePromotionTrail } from '../../../modules/groups/promotion.js';

const MAX_ARGUMENT_NODES = 60;
const MAX_ARGUMENT_DEPTH = 4;

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
    return renderPetitionOnboarding(options);
  }

  const now = Date.now();
  const voteBuckets = tallyVotes(state, votes, { now });
  const voteIndex = buildPetitionVoteIndex(votes);
  const signatureBuckets = buildSignatureBuckets(signatures || [], person);

  const topicCache = new Map();
  return petitions
    .map((petition) => {
      const topicLabel = resolveTopicBreadcrumb(petition, state, topicCache);
      const statusLabel = displayStatus(petition.status);
      const tally = voteBuckets.get(petition.id) || {
        yes: 0,
        no: 0,
        abstain: 0,
        pending: 0,
        lapsed: 0,
        delegated: 0,
        unresolved: 0,
      };
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
      const myResolution = resolveMyBallot(state, petition, voteIndex, person, now);
      const hasDelegatedBallot = Boolean(myResolution) && myResolution.status !== 'direct';
      const comments = commentsByPetition.get(petition.id) || [];
      const { argumentCount, lastCommentAt } = summarizeComments(comments);
      const revisions = Array.isArray(petition.versions) ? petition.versions : [];
      const anchorId = `petition-${petition.id}`;
      const proposalText = petition.freeze?.body ?? petition.body;
      const structuredFields = resolveStructuredFields(petition);
      const structuredOutline = renderStructuredOutline(structuredFields);
      const evidenceSummary = petition.freeze?.evidenceSummary ?? petition.evidenceSummary;
      const evidenceLinks = Array.isArray(petition.freeze?.evidenceLinks)
        ? petition.freeze.evidenceLinks
        : Array.isArray(petition.evidenceLinks)
          ? petition.evidenceLinks
          : [];
      const promotionNote = describePromotionTrail(petition);
      const promotionPill = promotionNote ? `<span class="pill ghost">${escapeHtml(promotionNote)}</span>` : '';
      const promoteControl = `${renderPromoteControl(petition, options)}${renderPromotionRequestControls(petition, options, {
        action: '/petitions/promote',
        idField: 'petitionId',
      })}`;
      const freezeNotice = renderFreezeNotice(petition, state);
      const reviewPrompt = renderReviewPrompt(petition, revisions);
      const evidenceBlock = renderEvidenceBlock(evidenceSummary, evidenceLinks);
      const createdAt = formatTimestamp(petition.createdAt);
      const stageKey = normalizeStage(petition.status);
      // Secondary counts live in one quiet sub-line instead of a wall of pills; the
      // detail disclosures below already carry Discussion/Version-history/Evidence, so
      // the head only keeps the state a reader acts on (stage, quorum, signatures).
      const subMeta = [
        renderUpdatedMeta(petition, state),
        `<span>Revisions: ${revisions.length}</span>`,
        `<span>Discussion: ${comments.length}</span>`,
        argumentCount ? `<span>Arguments: ${argumentCount}</span>` : '',
        lastCommentAt ? `<span>Last comment ${escapeHtml(lastCommentAt)}</span>` : '',
        `<a href="/petitions#${escapeHtml(anchorId)}">Permalink</a>`,
      ]
        .filter(Boolean)
        .join('');
      return `
        <article class="discussion proposal-card" id="${escapeHtml(anchorId)}">
          <div class="topic-head">
            ${renderActorAvatar(state, petition.authorHash || 'anonymous')}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, petition.authorHash || 'anonymous')}</span>
                ${createdAt ? `<span class="topic-time muted small">${createdAt}</span>` : ''}
              </div>
              <h3 class="topic-title">${escapeHtml(petition.title)}</h3>
              <div class="topic-meta">
                <span class="pill stage stage--${escapeHtml(stageKey)}">${escapeHtml(statusLabel)}</span>
                <span class="pill">Quorum: ${petition.quorum || 0}</span>
                <span class="pill ghost">Signatures: ${signatureCount}</span>
                ${petition.freeze ? '<span class="pill">Frozen</span>' : ''}
                <span class="pill ghost">Topic: ${escapeHtml(topicLabel)}</span>
                ${promotionPill}
                ${renderPreviewPill(petition)}
                ${renderIssuerPill(petition)}
              </div>
              <div class="proposal-submeta muted tiny">${subMeta}</div>
            </div>
          </div>
          ${renderStageTimeline(petition)}
          ${reviewPrompt}
          ${freezeNotice}
          <p>${escapeHtml(petition.summary)}</p>
          ${structuredOutline}
          ${evidenceBlock}
          ${renderProposalText(proposalText, petition.freeze ? 'Frozen proposal text' : 'Proposal text')}
          ${renderVoteTally(tally)}
          ${renderMyBallot(state, myResolution)}
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
              ${allowDelegation ? '<option value="auto">hand to my delegate</option>' : ''}
            </select>
            <button type="submit" class="ghost">${hasDelegatedBallot ? 'Override' : 'Vote'}</button>
          </form>
          `
          }
          ${promoteControl}
          ${renderDiscussionBlock(petition, comments, state)}
          ${renderDraftUpdateForm(petition, {
            canEdit,
            allowEditing,
            editGate,
            actorLabelPlural,
          })}
          ${renderRevisionHistory(petition, state)}
          ${canModerate ? renderModerationForm(petition, state) : ''}
        </article>
      `;
    })
    .join('\n');
}

// Offered only when the promotion would actually succeed: the caller passes a predicate
// that runs the same checks the POST handler will.
function renderPromoteControl(petition, options = {}) {
  if (typeof options.promotable !== 'function') return '';
  const decision = options.promotable(petition);
  if (!decision?.ok) return '';
  return `
    <form class="form-inline" method="post" action="/petitions/promote" data-enhance="petitions">
      <input type="hidden" name="petitionId" value="${escapeHtml(String(petition.id))}" />
      <button type="submit" class="ghost">Move up to ${escapeHtml(decision.targetLabel)}</button>
    </form>
  `;
}

function renderPetitionOnboarding(options = {}) {
  if (options.groupId) {
    return `
      <div class="onboarding-card">
        <p class="eyebrow">Group proposals</p>
        <h3>No proposals in this group's lane yet</h3>
        <p class="muted small">Proposals filed here stay internal to the group until they are moved up a level.</p>
        <div class="onboarding-actions">
          <a class="cta" href="#petitions-compose">Draft proposal</a>
        </div>
      </div>
    `;
  }
  return `
    <div class="onboarding-card">
      <p class="eyebrow">Proposals</p>
      <h3>No proposals yet</h3>
      <ul class="plain small">
        <li>Summarize the decision you need.</li>
        <li>Add structured outline details if helpful.</li>
        <li>Attach evidence links to support review.</li>
      </ul>
      <div class="onboarding-actions">
        <a class="cta" href="#petitions-compose">Draft proposal</a>
        <a class="ghost" href="#petitions-discussion">Review deliberations</a>
      </div>
    </div>
  `;
}


// A delegated ballot is resolved through the delegate's own vote before it is counted, and
// one still inside its window is reported apart from the abstentions rather than folded into
// them — see `delegatedBallots.js`.
function renderVoteTally(tally) {
  const parts = [`yes: ${tally.yes}`, `no: ${tally.no}`, `abstain: ${tally.abstain}`];
  if (tally.pending) parts.push(`awaiting delegates: ${tally.pending}`);
  const notes = [];
  if (tally.delegated) {
    notes.push(`${tally.delegated} delegated ${tally.delegated === 1 ? 'ballot' : 'ballots'}`);
  }
  if (tally.lapsed) {
    notes.push(`${tally.lapsed} lapsed to abstain`);
  }
  if (tally.unresolved) {
    notes.push(`${tally.unresolved} unresolvable chain${tally.unresolved === 1 ? '' : 's'}`);
  }
  const noteLine = notes.length ? `<p class="muted tiny">${escapeHtml(notes.join(' · '))}</p>` : '';
  return `<p class="muted small">Votes — ${escapeHtml(parts.join(' · '))}</p>${noteLine}`;
}

function resolveMyBallot(state, petition, voteIndex, person, now) {
  if (!person?.pidHash) return null;
  const byAuthor = voteIndex.get(petition.id);
  const myVote = byAuthor?.get(person.pidHash);
  if (!myVote) return null;
  return resolveVoteChoice(state, myVote, { byAuthor, now });
}

// The member's own standing on this proposal: a delegated ballot has to say who holds it,
// how long they have, and that overriding is available — otherwise the member has no way to
// tell a delegated vote from a silent one.
function renderMyBallot(state, resolution) {
  if (!resolution) return '';
  if (resolution.status === 'direct') {
    return `<p class="muted small">You voted <strong>${escapeHtml(resolution.choice)}</strong>.</p>`;
  }

  const delegateLabel = renderActorLabel(state, resolution.delegateHash, { showHash: false });
  const deadlineNote = resolution.deadline
    ? ` Deadline ${escapeHtml(formatTimestamp(resolution.deadline))}.`
    : ' No deadline is set in this deployment.';

  if (resolution.status === 'resolved') {
    const through =
      resolution.resolvedByHash && resolution.resolvedByHash !== resolution.delegateHash
        ? ` (forwarded to ${renderActorLabel(state, resolution.resolvedByHash, { showHash: false })})`
        : '';
    return `
      <div class="callout">
        <p class="small">Your ballot is delegated to ${delegateLabel}${through} and counted as
          <strong>${escapeHtml(resolution.choice)}</strong>.</p>
        <p class="muted tiny">Vote below to override it while the proposal is open.</p>
      </div>
    `;
  }
  if (resolution.status === 'pending') {
    const left =
      resolution.daysLeft === null
        ? 'no deadline'
        : `${resolution.daysLeft} day${resolution.daysLeft === 1 ? '' : 's'} left`;
    return `
      <div class="callout">
        <p class="small">Your ballot is delegated to ${delegateLabel} — awaiting their vote
          (<strong>${escapeHtml(left)}</strong>).</p>
        <p class="muted tiny">It is not counted yet.${deadlineNote} Vote below to override.</p>
      </div>
    `;
  }
  if (resolution.status === 'lapsed') {
    return `
      <div class="callout">
        <p class="small">Your delegate ${delegateLabel} did not vote in time — your ballot lapsed to
          <strong>abstain</strong>.</p>
        <p class="muted tiny">Vote below to record your own choice while the proposal is open.</p>
      </div>
    `;
  }
  const reason = resolution.reason === 'depth' ? 'the chain ran too deep' : 'the chain loops back';
  return `
    <div class="callout">
      <p class="small">Your delegated ballot could not resolve — ${escapeHtml(reason)}. It counts as
        <strong>abstain</strong>.</p>
      <p class="muted tiny">Vote below, or fix the delegation chain on the Delegation page.</p>
    </div>
  `;
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

function renderModerationForm(petition, state) {
  const status = petition.status === 'open' ? 'vote' : petition.status;
  const frozenAt = formatTimestamp(petition.freeze?.frozenAt);
  const frozenBy = petition.freeze?.frozenBy ? `@${resolveHandleForHash(state, petition.freeze.frozenBy)}` : '';
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
          <span>Category</span>
          <input name="topic" value="${escapeHtml(formatTopicInput(petition))}" placeholder="Energy / Solar" />
          <span class="muted tiny">Decides which delegations reach this proposal.</span>
        </label>
        <label class="field">
          <span>Summary</span>
          <textarea name="summary" rows="3" required>${escapeHtml(petition.summary || '')}</textarea>
        </label>
        <label class="field">
          <span>Problem statement (optional)</span>
          <textarea name="problem" rows="3">${escapeHtml(petition.problem || '')}</textarea>
        </label>
        <label class="field">
          <span>Proposed action (optional)</span>
          <textarea name="proposedAction" rows="3">${escapeHtml(petition.proposedAction || '')}</textarea>
        </label>
        <label class="field">
          <span>Impact (optional)</span>
          <textarea name="impact" rows="3">${escapeHtml(petition.impact || '')}</textarea>
        </label>
        <label class="field">
          <span>Risks and trade-offs (optional)</span>
          <textarea name="risks" rows="3">${escapeHtml(petition.risks || '')}</textarea>
        </label>
        <label class="field">
          <span>Implementation plan (optional)</span>
          <textarea name="implementationPlan" rows="3">${escapeHtml(petition.implementationPlan || '')}</textarea>
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

// The editable form of a proposal's topic: its full path, so editing a subcategory proposal
// and saving does not quietly flatten it back to the leaf label.
function formatTopicInput(petition) {
  const path = Array.isArray(petition?.topicPath) ? petition.topicPath.filter(Boolean) : [];
  if (path.length) return path.join(' / ');
  return petition?.topic || '';
}

function renderRevisionHistory(petition, state) {
  const versions = Array.isArray(petition.versions) ? petition.versions : [];
  if (!versions.length) return '';
  const items = versions
    .map((revision, index) => {
      const previous = versions[index + 1];
      const when = formatTimestamp(revision.createdAt);
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

function renderDiscussionBlock(petition, comments, state) {
  const count = comments.length;
  const disabled = petition.status === 'closed';
  const discussionList = renderPetitionComments(comments, state);
  const stanceSummary = renderCommentStanceSummary(comments);
  const argumentData = collectArgumentNodes(comments);
  const argumentMap = renderArgumentMap(argumentData, state);
  const argumentDatalistId = `argument-map-${petition.id}`;
  const argumentDatalist = renderArgumentDatalist(argumentData.nodes, argumentDatalistId);
  return `
    <details class="note">
      <summary>Discussion (${count})</summary>
      ${stanceSummary ? `<p class="muted small">${escapeHtml(stanceSummary)}</p>` : ''}
      ${argumentMap}
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
        <details class="note">
          <summary>Argument map (optional)</summary>
          <label class="field">
            <span>Argument title</span>
            <input name="argumentTitle" placeholder="Claim or evidence headline" />
          </label>
          <label class="field">
            <span>Builds on argument id</span>
            <input name="argumentParentId" list="${escapeHtml(argumentDatalistId)}" placeholder="Paste an argument id" />
          </label>
          ${argumentDatalist}
          <p class="muted small">Use short titles to map pro/con threads and link related notes.</p>
        </details>
        <label class="field">
          <span>Evidence / citations (optional)</span>
          <textarea name="evidenceLinks" rows="2" placeholder="https://example.org/report"></textarea>
        </label>
        <p class="muted small">One URL per line.</p>
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

function renderPetitionComments(comments, state) {
  if (!comments.length) {
    return renderEmptyState('No discussion notes yet.', { size: 'small' });
  }
  return comments
    .map((comment) => {
      const evidenceLinks = Array.isArray(comment.evidenceLinks) ? comment.evidenceLinks : [];
      const stanceLabel = getCommentStanceLabel(comment.stance);
      const factCheckPill = comment.factCheck ? '<span class="pill warning">Fact check</span>' : '';
      const argumentPill =
        comment.argumentTitle || comment.argumentParentId ? '<span class="pill ghost">Argument map</span>' : '';
      const evidencePill = evidenceLinks.length ? '<span class="pill ghost">Evidence</span>' : '';
      const createdAt = formatTimestamp(comment.createdAt);
      const argumentTitle = comment.argumentTitle
        ? `<p class="muted small">Argument: ${escapeHtml(comment.argumentTitle)}</p>`
        : '';
      const argumentParent = comment.argumentParentId
        ? `<p class="muted small">Builds on ${escapeHtml(String(comment.argumentParentId).slice(0, 8))}</p>`
        : '';
      const argumentId =
        comment.argumentTitle || comment.argumentParentId
          ? `<p class="muted tiny">Argument node <span class="mono" title="${escapeHtml(String(comment.id))}">${escapeHtml(String(comment.id).slice(0, 8))}…</span></p>`
          : '';
      const stanceKey = normalizeCommentStance(comment.stance);
      const coloredStance = `<span class="pill stance stance--${escapeHtml(stanceKey)}">${escapeHtml(stanceLabel)}</span>`;
      return `
        <article class="discussion comment-card">
          <div class="topic-head">
            ${renderActorAvatar(state, comment.authorHash || 'anonymous', { size: 'sm' })}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, comment.authorHash || 'anonymous')}</span>
                ${createdAt ? `<span class="topic-time muted small">${createdAt}</span>` : ''}
              </div>
              <div class="topic-meta">
                ${coloredStance}
                ${factCheckPill}
                ${argumentPill}
                ${evidencePill}
                ${renderPreviewPill(comment)}
                ${renderIssuerPill(comment)}
              </div>
            </div>
          </div>
          ${argumentTitle}
          ${argumentParent}
          <p>${escapeHtml(comment.content)}</p>
          ${renderEvidenceLinks(evidenceLinks)}
          ${argumentId}
        </article>
      `;
    })
    .join('\n');
}

export function renderProposalDiscussionFeed(items, state) {
  if (!items.length) {
    return renderEmptyState('No proposal discussions yet. Join a discussion to surface activity.');
  }
  return items
    .map(({ comment, petition }) => {
      const evidenceLinks = Array.isArray(comment.evidenceLinks) ? comment.evidenceLinks : [];
      const snippet = (comment.content || '').slice(0, 180);
      const anchorId = petition?.id ? `petition-${petition.id}` : null;
      const permalink = anchorId ? `<a class="pill ghost" href="/petitions#${escapeHtml(anchorId)}">Open proposal</a>` : '';
      const stanceLabel = getCommentStanceLabel(comment.stance);
      const stanceKey = normalizeCommentStance(comment.stance);
      const stancePill = `<span class="pill stance stance--${escapeHtml(stanceKey)}">${escapeHtml(stanceLabel)}</span>`;
      const factCheckPill = comment.factCheck ? '<span class="pill warning">Fact check</span>' : '';
      const argumentPill =
        comment.argumentTitle || comment.argumentParentId ? '<span class="pill ghost">Argument map</span>' : '';
      const evidencePill = evidenceLinks.length ? '<span class="pill ghost">Evidence</span>' : '';
      const argumentLine = comment.argumentTitle
        ? `<p class="muted small">Argument: ${escapeHtml(comment.argumentTitle)}</p>`
        : '';
      const createdAt = formatTimestamp(comment.createdAt);
      return `
        <article class="discussion comment-card">
          <div class="topic-head">
            ${renderActorAvatar(state, comment.authorHash || 'anonymous', { size: 'sm' })}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, comment.authorHash || 'anonymous')}</span>
                ${createdAt ? `<span class="topic-time muted small">${createdAt}</span>` : ''}
              </div>
              <div class="topic-breadcrumbs">On proposal · ${escapeHtml(displayStatus(petition?.status || 'draft'))}</div>
              <div class="topic-meta">
                ${stancePill}
                ${factCheckPill}
                ${argumentPill}
                ${evidencePill}
                ${renderPreviewPill(comment)}
                ${renderIssuerPill(comment)}
                ${permalink}
              </div>
            </div>
          </div>
          <p class="muted small">${escapeHtml(petition?.title || 'Proposal')}</p>
          ${argumentLine}
          <p>${escapeHtml(snippet)}</p>
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

function summarizeComments(comments = []) {
  if (!comments.length) return { argumentCount: 0, lastCommentAt: '' };
  let latest = 0;
  let argumentCount = 0;
  for (const comment of comments) {
    if (comment?.argumentTitle || comment?.argumentParentId) {
      argumentCount += 1;
    }
    const time = Date.parse(comment?.createdAt || '');
    if (!Number.isNaN(time) && time > latest) {
      latest = time;
    }
  }
  return { argumentCount, lastCommentAt: latest ? formatTimestamp(latest) : '' };
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

function collectArgumentNodes(comments = []) {
  const nodes = comments.filter((comment) => comment?.argumentTitle || comment?.argumentParentId);
  const sorted = nodes.slice().sort(sortByCreatedAt);
  const truncated = sorted.length > MAX_ARGUMENT_NODES;
  const limited = truncated ? sorted.slice(sorted.length - MAX_ARGUMENT_NODES) : sorted;
  return { nodes: limited, total: sorted.length, truncated };
}

function renderArgumentMap(argumentData, state) {
  if (!argumentData || !argumentData.nodes.length) return '';
  const { nodes, total, truncated } = argumentData;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const childMap = new Map();
  const roots = [];

  for (const node of nodes) {
    const parentId = node.argumentParentId;
    if (parentId && parentId !== node.id && nodeMap.has(parentId)) {
      const list = childMap.get(parentId) || [];
      list.push(node);
      childMap.set(parentId, list);
    } else {
      roots.push(node);
    }
  }

  roots.sort(sortByCreatedAt);
  for (const list of childMap.values()) {
    list.sort(sortByCreatedAt);
  }

  const visited = new Set();
  const items = roots.map((node) => renderArgumentNode(node, childMap, visited, 0, state)).join('');
  const truncatedNote = truncated
    ? `<p class="muted small">Showing latest ${nodes.length} of ${total} argument nodes.</p>`
    : '';
  return `
    <details class="note argument-map">
      <summary>Argument map (${total})</summary>
      ${truncatedNote}
      <ul class="argument-list">
        ${items}
      </ul>
    </details>
  `;
}

function renderArgumentNode(node, childMap, visited, depth, state) {
  if (!node || visited.has(node.id) || depth > MAX_ARGUMENT_DEPTH) return '';
  visited.add(node.id);
  const stanceLabel = getCommentStanceLabel(node.stance);
  const stancePill = `<span class="pill ghost">${escapeHtml(stanceLabel)}</span>`;
  const factCheckPill = node.factCheck ? '<span class="pill warning">Fact check</span>' : '';
  const previewPill = renderPreviewPill(node);
  const createdAt = formatTimestamp(node.createdAt);
  const title = node.argumentTitle || 'Argument note';
  const shortId = String(node.id || '').slice(0, 8);
  const parentHint = node.argumentParentId
    ? `Builds on ${escapeHtml(String(node.argumentParentId).slice(0, 8))}`
    : '';
  const content = node.content ? `<p>${escapeHtml(node.content)}</p>` : '';
  const author = renderAuthorHashLine(node.authorHash, { size: 'tiny', state });
  const children = childMap.get(node.id) || [];
  const childItems = children.map((child) => renderArgumentNode(child, childMap, visited, depth + 1, state)).join('');
  const childBlock = childItems ? `<ul class="argument-children">${childItems}</ul>` : '';
  return `
    <li>
      <div class="argument-node">
        <div class="discussion__meta">
          ${stancePill}
          ${factCheckPill}
          ${previewPill}
          ${renderIssuerPill(node)}
          ${createdAt ? `<span class="muted small">${escapeHtml(createdAt)}</span>` : ''}
        </div>
        <p class="small"><strong>${escapeHtml(title)}</strong> <span class="muted tiny">#${escapeHtml(shortId)}</span></p>
        ${parentHint ? `<p class="muted tiny">${parentHint}</p>` : ''}
        ${content}
        ${author}
      </div>
      ${childBlock}
    </li>
  `;
}

function renderArgumentDatalist(nodes = [], datalistId = 'argument-map-options') {
  if (!nodes.length) return '';
  const options = nodes
    .map((node) => {
      const label = node.argumentTitle || truncateText(node.content || 'Argument note', 80);
      const stanceLabel = getCommentStanceLabel(node.stance);
      return `<option value="${escapeHtml(node.id)}">${escapeHtml(label)} · ${escapeHtml(stanceLabel)}</option>`;
    })
    .join('');
  return `<datalist id="${escapeHtml(datalistId)}">${options}</datalist>`;
}

function resolveStructuredFields(petition) {
  const frozen = petition?.freeze || {};
  return {
    problem: frozen.problem || petition?.problem || '',
    proposedAction: frozen.proposedAction || petition?.proposedAction || '',
    impact: frozen.impact || petition?.impact || '',
    risks: frozen.risks || petition?.risks || '',
    implementationPlan: frozen.implementationPlan || petition?.implementationPlan || '',
  };
}

function renderStructuredOutline(fields = {}) {
  const entries = [
    { label: 'Problem statement', value: fields.problem },
    { label: 'Proposed action', value: fields.proposedAction },
    { label: 'Impact', value: fields.impact },
    { label: 'Risks and trade-offs', value: fields.risks },
    { label: 'Implementation plan', value: fields.implementationPlan },
  ];
  const filled = entries.filter((entry) => (entry.value || '').trim());
  if (!filled.length) return '';
  const items = filled
    .map((entry) => {
      return `
        <li>
          <p class="structured-label">${escapeHtml(entry.label)}</p>
          <p>${escapeHtml(entry.value)}</p>
        </li>
      `;
    })
    .join('');
  return `
    <details class="note structured-outline">
      <summary>Structured outline</summary>
      <ul class="plain structured-outline__list">
        ${items}
      </ul>
    </details>
  `;
}

function sortByCreatedAt(a, b) {
  const aTime = Date.parse(a?.createdAt || '');
  const bTime = Date.parse(b?.createdAt || '');
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (!aValid && !bValid) return 0;
  if (!aValid) return -1;
  if (!bValid) return 1;
  return aTime - bTime;
}

function renderUpdatedMeta(petition, state) {
  const updatedAt = petition.updatedAt || '';
  if (!updatedAt) return '';
  if (petition.createdAt && petition.createdAt === updatedAt && !petition.updatedBy) return '';
  const label = formatTimestamp(updatedAt);
  const author = petition.updatedBy ? ` by @${resolveHandleForHash(state, petition.updatedBy)}` : '';
  return `<span class="muted small">Updated ${escapeHtml(label)}${escapeHtml(author)}</span>`;
}


function renderFreezeNotice(petition, state) {
  if (!petition?.freeze) return '';
  const frozenAt = formatTimestamp(petition.freeze.frozenAt);
  const frozenBy = petition.freeze.frozenBy ? `by @${resolveHandleForHash(state, petition.freeze.frozenBy)}` : '';
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
  if ((revision.problem || '') !== (previous.problem || '')) {
    changes.push({ label: 'Problem', before: previous.problem, after: revision.problem });
  }
  if ((revision.proposedAction || '') !== (previous.proposedAction || '')) {
    changes.push({ label: 'Proposed action', before: previous.proposedAction, after: revision.proposedAction });
  }
  if ((revision.impact || '') !== (previous.impact || '')) {
    changes.push({ label: 'Impact', before: previous.impact, after: revision.impact });
  }
  if ((revision.risks || '') !== (previous.risks || '')) {
    changes.push({ label: 'Risks', before: previous.risks, after: revision.risks });
  }
  if ((revision.implementationPlan || '') !== (previous.implementationPlan || '')) {
    changes.push({
      label: 'Implementation plan',
      before: previous.implementationPlan,
      after: revision.implementationPlan,
    });
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
