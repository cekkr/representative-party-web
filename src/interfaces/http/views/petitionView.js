import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import {
  getCommentStanceLabel,
  listCommentStances,
  normalizeCommentStance,
} from '../../../modules/petitions/commentStance.js';
import {
  describeLaneScope,
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
  getDelegateVoteWindowDays,
  resolveVoteChoice,
  tallyVotes,
} from '../../../modules/delegation/delegatedBallots.js';
import { resolveDelegation } from '../../../modules/delegation/delegation.js';
import { canPostToGroupLane } from '../../../modules/groups/groupScope.js';
import { canonicalizeTopicKey } from '../../../modules/topics/topicMatch.js';
import { proposalBrowseHref, proposalHref, resolveProposalScope } from '../../../modules/petitions/proposalLinks.js';
import { describePromotionTrail } from '../../../modules/groups/promotion.js';
import { describeProposalWindow, listProposalsPastWindow } from '../../../modules/petitions/windows.js';

const MAX_ARGUMENT_NODES = 60;
const MAX_ARGUMENT_DEPTH = 4;

export function renderProposalCollection(proposals, { state, signatures, commentsByPetition, browse, activeGroupId, filteredEmpty, createHref }) {
  if (!proposals.length) {
    if (filteredEmpty) {
      return `<p>No proposals match this stage. <a href="${escapeHtml(proposalBrowseHref(activeGroupId))}" data-partial>Clear stage filter</a>.</p>`;
    }
    return `<div class="onboarding-card">
      <h3>No proposals yet</h3>
      <p>Draft a proposal when a discussion needs a formal decision.</p>
      ${createHref ? `<a class="cta" href="${escapeHtml(createHref)}" data-partial>Draft a proposal</a>` : ''}
    </div>`;
  }
  const signatureCounts = buildSignatureBuckets(signatures);
  const topicCache = new Map();
  const cards = proposals.map((proposal) => {
    const comments = commentsByPetition.get(proposal.id) || [];
    const signatureCount = signatureCounts.get(proposal.id)?.count || 0;
    return `
      <li>
        <article class="discussion record-card" id="petition-${escapeHtml(proposal.id)}">
          <header>
            <div class="topic-meta">${renderProposalStage(proposal)}${renderPreviewPill(proposal)}${renderIssuerPill(proposal)}</div>
            <h3><a href="${escapeHtml(proposalHref(proposal, browse))}" data-partial>${escapeHtml(proposal.title)}</a></h3>
            <p class="topic-breadcrumbs">${escapeHtml(resolveTopicBreadcrumb(proposal, state, topicCache))}</p>
          </header>
          <p>${escapeHtml(truncateText(proposal.summary, 240))}</p>
          <footer class="stack">
            ${renderProposalByline(proposal, state)}
            <p class="muted small">Signatures: ${signatureCount}${proposal.quorum ? ` / ${proposal.quorum}` : ''} · Discussion: ${comments.length}</p>
          </footer>
        </article>
      </li>
    `;
  });
  return `<ul class="collection-grid">${cards.join('')}</ul>`;
}

// The moderator queue: proposals whose discussion or vote window has passed.
// It only lists them — opening voting or closing it stays a moderator's action
// on the record, through the same stage form and gates.
export function renderProposalsPastWindow(state, person, { now = Date.now() } = {}) {
  const { total, items } = listProposalsPastWindow(state, person, { now });
  const rows = items.map(({ proposal, window }) => {
    const view = window.stage === 'vote' ? 'ballot' : 'overview';
    const what = window.stage === 'vote' ? 'Vote window' : 'Discussion window';
    const next = window.stage === 'vote' ? 'close voting' : 'open voting or return the draft';
    const over = window.daysOver ? `${pluralDays(window.daysOver)} ago` : 'today';
    const lane = describeLaneScope(resolveProposalScope(state, person, proposal));
    return `
          <li class="due-row">
            <a href="${escapeHtml(proposalHref(proposal, { view }))}" data-partial>${escapeHtml(proposal.title)}</a>
            <p class="muted small">${what} ended ${renderTimeValue(window.dueAt)} (${over}) · ${escapeHtml(lane)}</p>
            <p class="small">Next: ${next}.</p>
          </li>`;
  });
  const body = rows.length
    ? `<ul class="due-list">${rows.join('')}</ul>${total > items.length
      ? `<p class="muted small">${total - items.length} more past their window.</p>` : ''}`
    : '<p class="muted small">No proposal is past its discussion or vote window.</p>';
  return `
    <section class="panel stack" id="petitions-due" aria-labelledby="petitions-due-title" data-composer-section="petitions-due" data-section-label="Past their window">
      <p class="eyebrow">Moderation</p>
      <h2 id="petitions-due-title">Past their window</h2>
      <p class="muted small">The constitution's windows are guidance. Nothing advances on its own; you decide on the record.</p>
      ${body}
    </section>`;
}

export function renderProposalWorkspace(proposal, options) {
  const {
    state, person, scope, browse, view, signatures, comments, votes,
    allowEditing, allowSigning, allowCommenting, allowVoting, canVote, canModerate,
  } = options;
  const revisions = Array.isArray(proposal.versions) ? proposal.versions : [];
  const stage = normalizeStage(proposal.status);
  const signature = buildSignatureBuckets(signatures, person).get(proposal.id) || { count: 0, signed: false };
  const href = (target) => escapeHtml(proposalHref(proposal, { ...browse, view: target }));
  const returnFields = `
    ${browse.stage ? `<input type="hidden" name="browseStage" value="${escapeHtml(browse.stage)}" />` : ''}
    ${browse.page > 1 ? `<input type="hidden" name="browsePage" value="${browse.page}" />` : ''}
  `;
  const formFields = `<input type="hidden" name="petitionId" value="${escapeHtml(proposal.id)}" />${returnFields}`;
  const sections = [
    ['overview', 'Overview'],
    ['discussion', 'Discussion'],
    ['history', 'History'],
  ];
  const ballotAvailable = allowVoting && (stage === 'vote' || stage === 'closed' || Boolean(proposal.freeze));
  if (ballotAvailable || view === 'ballot') sections.push(['ballot', 'Ballot']);
  const scopeLabel = describeLaneScope(scope);
  const promotionNote = describePromotionTrail(proposal);
  const detail = `
    <section class="panel stack" data-composer-section="petition-details" data-section-label="Proposal details">
      <h2>Proposal details</h2>
      ${renderProposalByline(proposal, state)}
      ${renderUpdatedMeta(proposal, state)}
      ${renderPreviewPill(proposal)}${renderIssuerPill(proposal)}
      ${promotionNote ? `<p class="muted small">${escapeHtml(promotionNote)}</p>` : ''}
    </section>
  `;

  let content;
  let action = '';
  if (view === 'discussion') {
    content = renderDiscussionBlock(proposal, comments, state, { allowCommenting, formFields });
    if (allowCommenting && stage !== 'closed') {
      action = '<a class="cta" href="#proposal-comment">Add a contribution</a>';
    }
  } else if (view === 'history') {
    content = renderRevisionHistory(proposal, state, href);
    if (ballotAvailable) action = `<a class="ghost" href="${href('ballot')}" data-partial>Open ballot</a>`;
  } else if (view === 'ballot') {
    const votingOpen = stage === 'vote' && allowVoting;
    const now = Date.now();
    const resolution = resolveMyBallot(state, proposal, buildPetitionVoteIndex(votes), person, now);
    const tally = tallyVotes(state, votes, { now }).get(proposal.id) ||
      { yes: 0, no: 0, abstain: 0, pending: 0, lapsed: 0, delegated: 0, unresolved: 0 };
    const eligible = votingOpen && canVote;
    if (eligible) action = '<a class="cta" href="#proposal-vote">Go to your ballot</a>';
    content = `
      <section class="panel stack" id="proposal-ballot" data-composer-section="petition-ballot" data-section-label="Proposal ballot">
        <h2>Ballot</h2>
        ${renderBallotTiming(state, proposal, stage, now)}
        ${proposal.freeze
          ? `<h3>Frozen proposal text</h3>
             ${renderFreezeNotice(proposal, state, href('history'), revisions)}
             ${renderProposalContent(proposal.freeze)}`
          : `<p class="muted small">${stage === 'vote' || stage === 'closed'
            ? 'No frozen revision was recorded for this proposal.'
            : 'The proposal has yet to reach voting.'}</p>`}
        ${allowVoting ? renderMyBallot(state, resolution, eligible) : ''}
        ${eligible && !resolution && options.allowDelegation ? renderDelegationPreview(state, person, proposal, scope) : ''}
        ${eligible ? `
          <form class="form-inline" id="proposal-vote" method="post" action="/petitions/vote" data-enhance="petitions">
            ${formFields}
            <label class="field"><span>Your choice</span>${renderBallotSelect(resolution, options.allowDelegation)}</label>
            <button type="submit" class="cta">${!resolution ? 'Vote' : resolution.status === 'direct' ? 'Change vote' : 'Override'}</button>
          </form>
        ` : `<p class="muted small">${escapeHtml(!allowVoting ? 'Voting module disabled.' : !votingOpen
          ? stage === 'closed' ? 'Voting is closed.' : 'Voting opens after the proposal advances.'
          : options.voteNotice || 'Voting is unavailable for this session.')}</p>`}
        ${ballotAvailable ? `<section class="stack" aria-label="Voting outcome">
          <h3>Voting outcome</h3>
          ${renderVoteTally(tally)}
        </section>` : ''}
      </section>
    `;
  } else {
    const signingOpen = stage === 'draft' || stage === 'discussion';
    const canSign = signingOpen && allowSigning && !signature.signed;
    if (ballotAvailable) action = `<a class="cta" href="${href('ballot')}" data-partial>Open ballot</a>`;
    else if (canSign && stage === 'draft') action = '<a class="cta" href="#proposal-sign">Support this proposal</a>';
    else action = `<a class="ghost" href="${href('discussion')}" data-partial>Read discussion</a>`;
    const promoteControl = renderPromoteControl(proposal, options) + renderPromotionRequestControls(proposal, options, {
      action: '/petitions/promote',
      idField: 'petitionId',
    });
    content = `
      <section class="panel stack" id="proposal-overview" data-composer-section="petition-overview" data-section-label="Proposal overview">
        <h2>Overview</h2>
        ${renderDiscussionTiming(state, proposal, stage)}
        ${renderProposalContent(proposal.freeze || proposal)}
        <p class="muted small">Signatures: ${signature.count}${proposal.quorum ? ` / ${proposal.quorum} required for quorum` : ''}</p>
        ${signature.signed ? '<p class="muted small">You already signed.</p>' : ''}
        ${canSign ? `<form class="form-inline" id="proposal-sign" method="post" action="/petitions/sign" data-enhance="petitions">
          ${formFields}<button type="submit" class="ghost">Sign proposal</button>
        </form>` : ''}
        <p><a href="${href('history')}" data-partial>Version history</a> <span class="muted small">· Revisions: ${revisions.length}</span></p>
        ${renderDraftUpdateForm(proposal, { allowEditing, canEdit: allowEditing && isEditableStage(proposal.status), actorLabelPlural: options.actorLabelPlural, formFields })}
        ${renderReviewPrompt(proposal, revisions)}
        ${canModerate ? renderModerationForm(proposal, state, formFields) : ''}
        ${promoteControl}
      </section>
    `;
  }

  return {
    proposalAnchor: `petition-${escapeHtml(proposal.id)}`,
    proposalTitle: escapeHtml(proposal.title),
    proposalTopic: escapeHtml(resolveTopicBreadcrumb(proposal, state)),
    proposalScope: `<span class="pill ghost">${escapeHtml(scopeLabel)}</span>`,
    proposalStage: renderProposalStage(proposal),
    proposalReturnHref: escapeHtml(proposalBrowseHref(proposal.groupId, browse)),
    proposalAction: action,
    proposalSections: sections.map(([key, label]) =>
      `<a href="${href(key)}"${key === view ? ' aria-current="page"' : ''} data-partial>${label}</a>`,
    ).join(''),
    proposalContent: content,
    proposalDetails: detail,
  };
}

export function renderProposalStage(proposal) {
  const stage = normalizeStage(proposal.status);
  return `<span class="pill stage stage--${stage}">${formatStageLabel(stage)}</span>`;
}

function renderProposalByline(proposal, state) {
  const actor = proposal.authorHash || 'anonymous';
  const date = formatTimestamp(proposal.createdAt);
  return `<div class="topic-byline">
    ${renderActorAvatar(state, actor, { size: 'sm' })}
    <span class="topic-author">${renderActorLabel(state, actor)}</span>
    ${date ? `<time class="topic-time muted small" datetime="${escapeHtml(proposal.createdAt)}">${escapeHtml(date)}</time>` : ''}
  </div>`;
}

function renderProposalContent(proposal) {
  return `
    <p>${escapeHtml(proposal.summary || '')}</p>
    ${renderStructuredOutline(resolveStructuredFields(proposal))}
    ${renderEvidenceBlock(proposal.evidenceSummary, proposal.evidenceLinks)}
    ${renderProposalText(proposal.body)}
  `;
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
// The ballot select starts on the member's current choice. Defaulting a member who
// already voted "yes" back to "abstain" meant one careless click silently changed the vote.
function renderBallotSelect(resolution, allowDelegation) {
  const current = !resolution ? 'abstain' : resolution.status === 'direct' ? resolution.choice : 'auto';
  const options = [
    ['yes', 'yes'],
    ['no', 'no'],
    ['abstain', 'abstain'],
    ...(allowDelegation ? [['auto', 'hand to my delegate']] : []),
  ];
  return `
            <select name="choice">
              ${options
                .map(([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`)
                .join('')}
            </select>`;
}

function renderTimeValue(iso) {
  const label = formatTimestamp(iso);
  return label ? `<time datetime="${escapeHtml(iso)}">${escapeHtml(label)}</time>` : '';
}

function pluralDays(count) {
  return `${count} day${count === 1 ? '' : 's'}`;
}

// One window line: its length, the guidance date, and how far along it is.
// `closer` names who acts when it passes, because nothing acts automatically.
function renderWindowValue(window, closer) {
  if (!window?.windowDays) return `None set. ${closer}`;
  if (!window.known) return `${pluralDays(window.windowDays)}, measured from when this stage opened, which was not recorded. ${closer}`;
  const remaining = window.elapsed
    ? ` · window elapsed${window.daysOver ? ` ${pluralDays(window.daysOver)} ago` : ''}`
    : ` · ${pluralDays(window.daysLeft)} left`;
  return `${pluralDays(window.windowDays)}, until ${renderTimeValue(window.dueAt)}${remaining}. ${closer}`;
}

// Discussion has its own published window. Like the vote window it is
// guidance: a moderator opens voting or returns the draft.
function renderDiscussionTiming(state, proposal, stage, now = Date.now()) {
  if (stage !== 'discussion') return '';
  const window = describeProposalWindow(state, proposal, now);
  const rows = [];
  if (window?.openedAt) rows.push(['Discussion opened', renderTimeValue(window.openedAt)]);
  rows.push(['Discussion window', renderWindowValue(window, 'A moderator opens voting.')]);
  return `
        <dl class="ballot-timing stage-timing" aria-label="Discussion timeline">
          ${rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('')}
        </dl>`;
}

// When voting opened and closed, and the constitution's windows that apply to it.
// The vote window is published guidance: a moderator closes voting, so the page
// says so rather than implying an automatic deadline.
function renderBallotTiming(state, proposal, stage, now = Date.now()) {
  if (stage !== 'vote' && stage !== 'closed') return '';
  const rows = [];
  const openedAt = proposal.freeze?.frozenAt;
  if (openedAt) rows.push(['Voting opened', renderTimeValue(openedAt)]);
  if (stage === 'closed') {
    const closedBy = proposal.closedBy && proposal.closedBy !== 'anonymous'
      ? ` by ${renderActorLabel(state, proposal.closedBy, { showHash: false })}`
      : '';
    rows.push(['Voting closed', proposal.closedAt
      ? `${renderTimeValue(proposal.closedAt)}${closedBy}`
      : 'Closed before closing times were recorded']);
  } else {
    rows.push(['Vote window', renderWindowValue(describeProposalWindow(state, proposal, now), 'A moderator closes voting.')]);
  }
  const delegateDays = getDelegateVoteWindowDays(state);
  rows.push(['Delegate window', delegateDays
    ? `${delegateDays} day${delegateDays === 1 ? '' : 's'} to vote a ballot handed to a delegate`
    : 'No deadline for delegated ballots']);
  return `
        <dl class="ballot-timing" aria-label="Voting timeline">
          ${rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('')}
        </dl>`;
}

// Before a member chooses, say what "hand to my delegate" would do on this
// proposal: who would hold the ballot, through which topic, and for how long.
// Read-only: resolution runs without notifications, and the POST re-resolves.
function renderDelegationPreview(state, person, proposal, scope) {
  if (!person?.pidHash) return '';
  const delegation = resolveDelegation(person, proposal.topic, state, { topicPath: proposal.topicPath });
  const topicLabel = resolveTopicBreadcrumb(proposal, state);
  if (!delegation?.delegateHash) {
    return `
        <p class="muted small ballot-delegation">No delegation of yours covers ${escapeHtml(topicLabel)}.
          Handing this ballot to a delegate records an abstention.
          <a href="/delegation#delegation-set" data-partial>Set a delegation</a></p>`;
  }
  const holder = renderActorLabel(state, delegation.delegateHash, { showHash: false });
  if (scope?.group && !canPostToGroupLane(state, { pidHash: delegation.delegateHash }, scope.group, 'petitions')) {
    return `
        <p class="muted small ballot-delegation">Your delegate ${holder} is not a member of this lane,
          so they cannot hold this ballot. Choose a vote yourself.</p>`;
  }
  const days = getDelegateVoteWindowDays(state);
  const matched = labelMatchedTopic(delegation.matchedTopic || delegation.topic || proposal.topic || 'general', topicLabel);
  const forwarded = delegation.transitive && delegation.immediateDelegateHash !== delegation.delegateHash
    ? ` through ${renderActorLabel(state, delegation.immediateDelegateHash, { showHash: false })}`
    : '';
  return `
        <p class="muted small ballot-delegation">Handing this ballot to your delegate gives it to ${holder}${forwarded}
          under your <strong>${escapeHtml(matched)}</strong> delegation.
          ${days ? `They have ${days} day${days === 1 ? '' : 's'} to vote.` : 'There is no deadline for them to vote.'}
          You can vote yourself at any time to override.</p>`;
}

// A delegation is stored under the key the member typed, lowercased. When it is
// one of this proposal's own categories, name it as the breadcrumb writes it.
function labelMatchedTopic(matched, breadcrumb) {
  const key = canonicalizeTopicKey(matched);
  const segments = String(breadcrumb || '').split('/').map((segment) => segment.trim()).filter(Boolean);
  for (let depth = segments.length; depth > 0; depth -= 1) {
    const prefix = segments.slice(0, depth);
    if (canonicalizeTopicKey(prefix.join('/')) === key) return prefix.join(' / ');
    if (canonicalizeTopicKey(segments[depth - 1]) === key) return segments[depth - 1];
  }
  return matched;
}

function renderMyBallot(state, resolution, eligible) {
  if (!resolution) return '';
  const override = eligible ? ' Cast your own vote to override.' : '';
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
        <p class="muted tiny">${override}</p>
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
        <p class="muted tiny">It is awaiting resolution.${deadlineNote}${override}</p>
      </div>
    `;
  }
  if (resolution.status === 'lapsed') {
    return `
      <div class="callout">
        <p class="small">Your delegate ${delegateLabel} did not vote in time — your ballot lapsed to
          <strong>abstain</strong>.</p>
        <p class="muted tiny">${override}</p>
      </div>
    `;
  }
  const reason = resolution.reason === 'depth' ? 'the chain ran too deep' : 'the chain loops back';
  return `
    <div class="callout">
      <p class="small">Your delegated ballot could not resolve — ${escapeHtml(reason)}. It counts as
        <strong>abstain</strong>.</p>
      <p class="muted tiny">${override}</p>
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

function renderModerationForm(petition, state, formFields) {
  const status = petition.status === 'open' ? 'vote' : petition.status;
  const frozenAt = formatTimestamp(petition.freeze?.frozenAt);
  const frozenBy = petition.freeze?.frozenBy ? `@${resolveHandleForHash(state, petition.freeze.frozenBy)}` : '';
  const freezeNote = frozenAt ? `<p class="muted small">Frozen at ${escapeHtml(frozenAt)} ${frozenBy ? `by ${escapeHtml(frozenBy)}` : ''}.</p>` : '';
  return `
    <form class="form-inline" method="post" action="/petitions/status" data-enhance="petitions">
        ${formFields}
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

function renderDraftUpdateForm(petition, { canEdit, allowEditing, actorLabelPlural, formFields }) {
  if (!allowEditing) {
    return '';
  }
  if (!canEdit) {
    return '<p class="muted small">Draft editing closes once the vote stage opens. Review the frozen text before voting.</p>';
  }
  return `
    <details class="note">
      <summary>Update draft (collaborative)</summary>
      <p class="muted small">Verified ${escapeHtml(actorLabelPlural)} can refine this proposal while it is in draft or discussion.</p>
      <form class="stack" method="post" action="/petitions/update" data-enhance="petitions">
        ${formFields}
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

function renderRevisionHistory(petition, state, href) {
  const versions = Array.isArray(petition.versions) ? petition.versions : [];
  const items = versions
    .map((revision, index) => {
      const previous = versions[index + 1];
      const when = formatTimestamp(revision.createdAt);
      // Resolve through the shared label so a revision reads as @handle (with the hash cue)
      // like every other byline, instead of a bare stored handle or a raw hash.
      const author = revision.authorHash
        ? renderActorLabel(state, revision.authorHash)
        : escapeHtml(revision.authorHandle ? `@${revision.authorHandle}` : 'anonymous');
      const note = revision.note ? `<div class="muted small">${escapeHtml(String(revision.note))}</div>` : '';
      const topicLabel = resolveTopicBreadcrumb(revision, state);
      // The first revision's note already says it is the initial draft; do not repeat it.
      const diffBlock = !previous && revision.note ? '' : renderRevisionDiff(revision, previous, state);
      return `
        <li${revision.id ? ` id="revision-${escapeHtml(revision.id)}"` : ''}>
          <div class="muted small">${escapeHtml(when)} · ${author} · Topic: ${escapeHtml(topicLabel)}</div>
          ${revision.id && petition.freeze?.revisionId === revision.id
            ? `<p><a href="${href('ballot')}" data-partial>Revision used for the ballot</a></p>` : ''}
          <div>${escapeHtml(revision.title || petition.title || 'Untitled')}</div>
          ${note}
          ${diffBlock}
        </li>
      `;
    })
    .join('');
  return `
    <section class="panel stack" id="proposal-history" data-composer-section="petition-history" data-section-label="Proposal history">
      <h2>Version history <span class="muted small">(${versions.length})</span></h2>
      ${items ? `<ol class="plain stack">${items}</ol>` : '<p class="muted">No revisions recorded.</p>'}
    </section>
  `;
}

function renderDiscussionBlock(petition, comments, state, { allowCommenting, formFields }) {
  const count = comments.length;
  const disabled = petition.status === 'closed';
  // Stored newest-first; a deliberation reads oldest-first so a rebuttal follows the
  // objection it answers.
  const ordered = comments.slice().sort(sortByCreatedAt);
  const discussionList = renderPetitionComments(ordered, state, { argumentTitles: indexArgumentTitles(comments) });
  const stanceSummary = renderCommentStanceSummary(comments);
  const argumentData = collectArgumentNodes(comments);
  const argumentMap = renderArgumentMap(argumentData, state);
  const argumentDatalistId = `argument-map-${petition.id}`;
  const argumentDatalist = renderArgumentDatalist(argumentData.nodes, argumentDatalistId);
  return `
    <section class="panel stack" id="petitions-discussion" data-composer-section="petitions-discussion" data-section-label="Proposal discussion">
      <h2>Discussion <span class="muted small">(${count})</span></h2>
      ${stanceSummary ? `<p class="muted small">${escapeHtml(stanceSummary)}</p>` : ''}
      <div class="discussion-list">
        ${discussionList}
      </div>
      ${argumentMap}
      ${
        disabled
          ? '<p class="muted small">Discussion closed.</p>'
          : allowCommenting ? `
      <form class="stack" id="proposal-comment" method="post" action="/petitions/comment" data-enhance="petitions">
        ${formFields}
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
            <span>Builds on (pick an argument from the map)</span>
            <input name="argumentParentId" list="${escapeHtml(argumentDatalistId)}" placeholder="Start typing a claim title" />
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
        <p class="muted small">Replying to ${escapeHtml(petition.title)}.</p>
        <button class="cta" type="submit">Post comment</button>
      </form>
      ` : '<p class="muted small">Posting requires access to this proposal’s discussion.</p>'
      }
    </section>
  `;
}

// Argument node id -> the title a member gave it, so "builds on" names the claim being
// answered instead of printing a raw node id.
function indexArgumentTitles(comments = []) {
  const titles = new Map();
  for (const comment of comments) {
    if (!comment?.id) continue;
    titles.set(comment.id, ownArgumentTitle(comment) || truncateText(comment.content || 'an earlier note', 60));
  }
  return titles;
}

// Older comments may have an autogenerated title on an untitled reply.
function ownArgumentTitle(node) {
  const title = node?.argumentTitle || '';
  return node?.argumentParentId && title === 'Argument note' ? '' : title;
}

function describeArgumentParent(parentId, titles) {
  const title = titles?.get(parentId);
  return title
    ? `<a href="#proposal-note-${escapeHtml(parentId)}">Builds on “${escapeHtml(title)}”</a>`
    : 'The original claim is unavailable.';
}

function renderPetitionComments(comments, state, { argumentTitles } = {}) {
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
      const argumentTitle = ownArgumentTitle(comment)
        ? `<p class="muted small">Argument: ${escapeHtml(ownArgumentTitle(comment))}</p>`
        : '';
      const argumentParent = comment.argumentParentId
        ? `<p class="muted small">${describeArgumentParent(comment.argumentParentId, argumentTitles)}</p>`
        : '';
      const stanceKey = normalizeCommentStance(comment.stance);
      const coloredStance = `<span class="pill stance stance--${escapeHtml(stanceKey)}">${escapeHtml(stanceLabel)}</span>`;
      return `
        <article class="discussion comment-card" id="proposal-note-${escapeHtml(comment.id)}">
          <div class="topic-head">
            ${renderActorAvatar(state, comment.authorHash || 'anonymous', { size: 'sm' })}
            <div class="topic-info">
              <div class="topic-byline">
                <span class="topic-author">${renderActorLabel(state, comment.authorHash || 'anonymous')}</span>
                ${createdAt ? `<time class="topic-time muted small" datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(createdAt)}</time>` : ''}
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
          <a class="small" href="#proposal-note-${escapeHtml(comment.id)}">Permalink</a>
        </article>
      `;
    })
    .join('\n');
}

export function renderProposalDiscussionFeed(items, state, browse) {
  if (!items.length) {
    return renderEmptyState('No proposal discussions yet. Join a discussion to surface activity.');
  }
  return items
    .map(({ comment, petition }) => {
      const evidenceLinks = Array.isArray(comment.evidenceLinks) ? comment.evidenceLinks : [];
      const snippet = (comment.content || '').slice(0, 180);
      const href = proposalHref(petition, { ...browse, view: 'discussion' });
      const permalink = `<a class="pill ghost" href="${escapeHtml(href)}#proposal-note-${escapeHtml(comment.id)}" data-partial>Open discussion</a>`;
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
                ${createdAt ? `<time class="topic-time muted small" datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(createdAt)}</time>` : ''}
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
  const titles = indexArgumentTitles(nodes);
  const items = roots.map((node) => renderArgumentNode(node, childMap, visited, 0, state, titles)).join('');
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

function renderArgumentNode(node, childMap, visited, depth, state, titles) {
  if (!node || visited.has(node.id) || depth > MAX_ARGUMENT_DEPTH) return '';
  visited.add(node.id);
  const stanceLabel = getCommentStanceLabel(node.stance);
  const stancePill = `<span class="pill ghost">${escapeHtml(stanceLabel)}</span>`;
  const factCheckPill = node.factCheck ? '<span class="pill warning">Fact check</span>' : '';
  const previewPill = renderPreviewPill(node);
  const createdAt = formatTimestamp(node.createdAt);
  const title = ownArgumentTitle(node) || (node.argumentParentId ? 'Reply' : 'Argument note');
  const shortId = String(node.id || '').slice(0, 8);
  const parentHint = node.argumentParentId ? describeArgumentParent(node.argumentParentId, titles) : '';
  const content = node.content ? `<p>${escapeHtml(node.content)}</p>` : '';
  const author = renderAuthorHashLine(node.authorHash, { size: 'tiny', state });
  const children = childMap.get(node.id) || [];
  const childItems = children.map((child) => renderArgumentNode(child, childMap, visited, depth + 1, state, titles)).join('');
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
      const label = ownArgumentTitle(node) || truncateText(node.content || 'Argument note', 80);
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
    <details class="note structured-outline" open>
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


function renderFreezeNotice(petition, state, historyHref, revisions) {
  if (!petition?.freeze) return '';
  const frozenAt = formatTimestamp(petition.freeze.frozenAt);
  const frozenBy = petition.freeze.frozenBy ? `by @${resolveHandleForHash(state, petition.freeze.frozenBy)}` : '';
  const revisionId = petition.freeze.revisionId ? petition.freeze.revisionId.slice(0, 8) : '';
  const revisionLink = revisions.some((revision) => revision.id === petition.freeze.revisionId);
  const revisionLine = revisionId
    ? `<p class="muted small">${revisionLink
      ? `<a href="${historyHref}#revision-${escapeHtml(petition.freeze.revisionId)}" data-partial>Frozen revision ${escapeHtml(revisionId)}</a>`
      : `Frozen revision ${escapeHtml(revisionId)}`}</p>`
    : '';
  return `
    <div class="callout">
      <p class="muted small">Frozen ${frozenAt ? `at ${escapeHtml(frozenAt)}` : 'for voting'} ${escapeHtml(frozenBy)}.</p>
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
