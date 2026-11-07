import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { classifyTopic } from '../../topics/classification.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { resolveDelegation } from '../../delegation/delegation.js';
import { findGroupById, recommendDelegationForPerson } from '../../groups/groups.js';
import { evaluateAction, getEffectivePolicy } from '../../circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { createNotification, createNotificationWithOutbound } from '../../messaging/notifications.js';
import { persistDiscussions, persistPetitions, persistVotes } from '../../../infra/persistence/storage.js';
import { countSignatures, getQuorumAdvanceStage, hasSigned, signPetition } from '../signatures.js';
import { buildFreezeSnapshot } from '../lifecycle.js';
import { canReadProposal, proposalBrowseHref, proposalHref, readProposalBrowse, resolveProposalScope } from '../proposalLinks.js';
import { resolveNotificationPreferences } from '../../messaging/outbound.js';
import { extractMentions } from '../../social/posts.js';
import { findSessionByHandle, findSessionByHash } from '../../identity/sessions.js';
import { buildVoteEnvelope } from '../../votes/voteEnvelope.js';
import { filterVisibleEntries, findVisibleEntry, stampLocalEntry } from '../../federation/replication.js';
import { logTransaction } from '../../transactions/registry.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { renderProposalCollection, renderProposalDiscussionFeed, renderProposalWorkspace } from '../../../interfaces/http/views/petitionView.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { paginate } from '../../../shared/utils/pagination.js';
import { getActorLabels, resolveHandleForHash, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../../../interfaces/http/views/moduleGate.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { recordRateLimit } from '../../ops/metrics.js';
import { normalizeCommentStance } from '../../petitions/commentStance.js';
import { getGovernanceSettings } from '../../governance/constitution.js';
import { getTopicConfig } from '../../topics/topicGardenerClient.js';
import { getTopicPreferences } from '../../topics/preferences.js';
import { buildTopicOptions, renderTopicDatalist } from '../../../interfaces/http/views/topicHelpers.js';
import {
  DELEGATED_CHOICE,
  buildDelegatedBallot,
  getDelegateVoteWindowDays,
  listOwnersFollowingDelegate,
} from '../../delegation/delegatedBallots.js';
import {
  canPostToGroupLane,
  listPostableGroupLanes,
  listReadableGroupLanes,
  matchesGroupScope,
  readGroupScope,
  resolveGroupScope,
} from '../../groups/groupScope.js';
import {
  applyPromotion,
  applyPromotionDecision,
  applyPromotionRequest,
  evaluatePromotion,
  evaluatePromotionDecision,
  evaluatePromotionRequest,
} from '../../groups/promotion.js';


// A proposal's topic decides which delegations, group cachets and category filters can ever
// reach it. The classifier only ever returns an anchor, and with no gardener or classifying
// extension installed that is always the first anchor — so every proposal on a default
// deployment landed on `general`, collapsing topic-scoped delegation to a single bucket.
// A member's own pick is therefore authoritative when they made one; the classifier is the
// fallback for when they did not. `previous` keeps an edit that omits the field from
// silently reclassifying a proposal someone already filed deliberately.
async function resolvePetitionTopic(state, { input, classifyText, previous } = {}) {
  const picked = sanitizeText(input || '', 80);
  const fallback = picked || previous || '';
  const raw = fallback || (await classifyTopic(classifyText || '', state));
  const result = await ensureTopicPath(state, raw, { source: 'petition' });
  return {
    topic: result.topic?.label || raw || 'general',
    topicId: result.topic?.id || null,
    topicPath: result.path?.length ? result.path.map((entry) => entry.label) : [],
    chosenByAuthor: Boolean(picked),
  };
}

export async function renderPetitions({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'petitions' });
  }
  const person = getPerson(req, state);
  const query = url || new URL(req.url, `http://${req.headers.host}`);
  const browse = readProposalBrowse(query.searchParams);
  if (query.searchParams.has('proposal')) {
    return renderFocusedProposal({ res, state, wantsPartial, person, query, browse });
  }

  const scope = resolveGroupScope(state, person, readGroupScope(query.searchParams), { lane: 'petitions' });
  const activeGroupId = scope.ok ? scope.groupId : null;
  const petitions = filterVisibleEntries(state.petitions, state, (entry) => matchesGroupScope(entry, activeGroupId));
  const stageFilter = browse.stage || 'all';
  const filtered = filterPetitionsByStage(petitions, stageFilter);
  const pageInfo = paginate(filtered, { page: browse.page });
  const pageBrowse = { ...browse, page: pageInfo.page };
  const petitionLookup = buildPetitionLookup(filtered);
  const comments = filterVisibleEntries(state.discussions, state, (entry) => petitionLookup.has(entry.petitionId));
  const commentsByPetition = groupCommentsByPetition(comments);
  const signatures = filterVisibleEntries(state.signatures, state, (entry) => petitionLookup.has(entry.petitionId));
  const petitionGate = evaluateAction(state, person, 'petition');
  const canParticipate = canPostToGroupLane(state, person, scope.ok ? scope.group : null, 'petitions');
  const canCompose = petitionGate.allowed && canParticipate;
  const composeUrl = new URL(proposalBrowseHref(activeGroupId, pageBrowse), 'http://local');
  composeUrl.searchParams.set('compose', 'proposal');
  const createHref = composeUrl.pathname + composeUrl.search + '#petitions-compose';
  const modules = resolveModuleSettings(state);
  const topicConfig = getTopicConfig(state);
  const html = await renderPage(
    'petitions',
    {
      person,
      personHandle: resolvePersonHandle(person),
      workspaceCreateHref: canCompose ? createHref : '',
      petitionsCreateAction: canCompose ? `<a class="cta" href="${escapeHtml(createHref)}" data-partial>Draft proposal</a>` : '',
      petitionsScopeLabel: escapeHtml(scope.ok && scope.group ? scope.group.name || 'Group' : 'Whole Circle'),
      petitionsScopeTabs: renderPetitionScopeTabs({ state, person, activeGroupId }),
      petitionsScopeNotice: scope.ok ? '' : `<p class="muted small">${escapeHtml(scope.message)}</p>`,
      petitionsFilterScope: activeGroupId ? `<input type="hidden" name="group" value="${escapeHtml(activeGroupId)}" />` : '',
      petitionsList: renderProposalCollection(pageInfo.items, {
        state, signatures, commentsByPetition, browse: pageBrowse, activeGroupId,
        filteredEmpty: Boolean(browse.stage && petitions.length),
        createHref: canCompose ? createHref : '',
      }),
      petitionsPager: renderPager(pageInfo, {
        baseHref: '/petitions',
        query: { stage: browse.stage, group: activeGroupId || '' },
        label: 'proposals',
      }),
      petitionsGroupPicker: renderPetitionGroupPicker(state, person, activeGroupId),
      proposalComposeFormHidden: canCompose ? '' : 'hidden',
      proposalComposeNotice: canCompose ? '' : escapeHtml(canParticipate
        ? petitionGate.message || 'Drafting is unavailable for this session.'
        : 'Join the group to draft a proposal here.'),
      topicDatalist: renderTopicDatalist(buildTopicOptions({
        anchors: topicConfig.anchors,
        pinned: topicConfig.pinned,
        preferences: getTopicPreferences(state, person),
        entries: petitions,
      })),
      delegationSuggestions: modules.delegation && modules.groups
        ? renderSuggestions(person, state)
        : modules.delegation ? 'Group suggestions unavailable (groups disabled).' : 'Delegation module disabled.',
      quorumAdvanceLabel: getQuorumAdvanceLabel(state),
      quorumDefault: getGovernanceSettings(state).quorumDefault,
      discussionFeed: renderProposalDiscussionFeed(buildDiscussionFeedItems(comments, petitionLookup), state, pageBrowse),
      stageFilterOptions: renderStageFilterOptions(stageFilter),
      composeOpen: query.searchParams.has('compose') && canCompose ? 'open' : '',
    },
    { wantsPartial, title: 'Proposals & Votes', state },
  );
  return sendHtml(res, html);
}

async function renderFocusedProposal({ res, state, wantsPartial, person, query, browse }) {
  const id = sanitizeText(query.searchParams.get('proposal'), 120);
  const proposal = findVisibleEntry(state.petitions, state, (entry) => entry.id === id);
  if (!canReadProposal(state, person, proposal)) {
    const html = await renderPage('petition-unavailable', { person, pageKey: 'petitions' }, {
      state, wantsPartial, title: 'Proposal unavailable',
    });
    return sendHtml(res, html, {}, 404);
  }

  const scope = resolveProposalScope(state, person, proposal);
  const requestedView = query.searchParams.get('view');
  const view = ['discussion', 'history', 'ballot'].includes(requestedView) ? requestedView : 'overview';
  if (!matchesGroupScope(proposal, readGroupScope(query.searchParams))) {
    return sendRedirect(res, proposalHref(proposal, { ...browse, view }));
  }

  const canParticipate = canPostToGroupLane(state, person, scope.group, 'petitions');
  const petitionGate = evaluateAction(state, person, 'petition');
  const voteGate = evaluateAction(state, person, 'vote');
  const postGate = evaluateAction(state, person, 'post');
  const modules = resolveModuleSettings(state);
  const html = await renderPage('petition-workspace', {
    person,
    pageKey: 'petitions',
    ...renderProposalWorkspace(proposal, {
      state, person, scope, browse, view,
      signatures: filterVisibleEntries(state.signatures, state, (entry) => entry.petitionId === id),
      comments: view === 'discussion'
        ? filterVisibleEntries(state.discussions, state, (entry) => entry.petitionId === id)
        : [],
      votes: view === 'ballot' && modules.votes
        ? filterVisibleEntries(state.votes, state, (entry) => entry.petitionId === id)
        : [],
      allowEditing: canParticipate && petitionGate.allowed,
      allowSigning: canParticipate && voteGate.allowed,
      allowCommenting: canParticipate && postGate.allowed,
      allowVoting: modules.votes,
      canVote: canParticipate && voteGate.allowed,
      voteNotice: canParticipate ? voteGate.message : 'Join the group to vote on this proposal.',
      allowDelegation: modules.delegation,
      canModerate: evaluateAction(state, person, 'moderate').allowed,
      actorLabelPlural: getActorLabels(state).actorLabelPlural,
      promotable: (entry) => evaluatePromotion(state, person, { kind: 'petition', entry }),
      requestable: (entry) => evaluatePromotionRequest(state, person, { kind: 'petition', entry }),
      decidable: (entry) => evaluatePromotionDecision(state, person, { kind: 'petition', entry }),
    }),
  }, { state, wantsPartial, title: proposal.title });
  return sendHtml(res, html);
}

function requirePetitionAction(res, state, person, petitionId, { requireMembership = true } = {}) {
  const petition = findVisibleEntry(state.petitions, state, (item) => item.id === petitionId);
  if (!petition) {
    sendJson(res, 404, { error: 'petition_not_found' });
    return null;
  }
  // A submitted group cannot authorize an action. Always check the record's current lane.
  const scope = resolveProposalScope(state, person, petition);
  if (!scope.ok) {
    sendJson(res, scope.error === 'group_not_found' ? 404 : 403, { error: scope.error, message: scope.message });
    return null;
  }
  if (requireMembership && !canPostToGroupLane(state, person, scope.group, 'petitions')) {
    sendJson(res, 403, { error: 'group_membership_required', message: 'Join the group to participate in its proposal lane.' });
    return null;
  }
  return petition;
}

function redirectToProposal(res, proposal, view, body = {}) {
  const browse = readProposalBrowse(new URLSearchParams({ stage: body.browseStage || '', page: body.browsePage || '' }));
  return sendRedirect(res, proposalHref(proposal, { ...browse, view }));
}

function renderPetitionScopeTabs({ state, person, activeGroupId }) {
  const groups = listReadableGroupLanes(state, person, 'petitions');
  if (!groups.length) return '';
  const tab = (href, label, active) =>
    `<a class="pill ${active ? '' : 'ghost'}" href="${escapeHtml(href)}" ${active ? 'aria-current="page"' : ''} data-partial>${escapeHtml(label)}</a>`;
  const tabs = [tab('/petitions', 'Whole Circle', !activeGroupId)];
  for (const group of groups) {
    tabs.push(
      tab(`/petitions?group=${encodeURIComponent(group.id)}`, group.name || 'Group', activeGroupId === group.id),
    );
  }
  return `<nav class="discussion__meta" aria-label="Proposal lanes">${tabs.join('')}</nav>`;
}

// Only shown when the member belongs to a group with an open proposals lane.
function renderPetitionGroupPicker(state, person, activeGroupId) {
  const groups = listPostableGroupLanes(state, person, 'petitions');
  if (!groups.length) return '';
  const options = groups
    .map(
      (group) =>
        `<option value="${escapeHtml(group.id)}" ${activeGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.name || 'Group')}</option>`,
    )
    .join('');
  return `
    <label class="field">
      <span>Propose to</span>
      <select name="groupId">
        <option value="" ${activeGroupId ? '' : 'selected'}>Whole Circle</option>
        ${options}
      </select>
    </label>
  `;
}

function renderSuggestions(person, state) {
  if (!person) return 'Login to see group delegate suggestions.';
  const rec = recommendDelegationForPerson(person, 'general', state);
  if (!rec.suggestions || !rec.suggestions.length) return 'No suggestions.';
  const conflictNote = rec.conflict
    ? `<p class="muted small">Conflict detected (${rec.conflictRule || 'highest_priority'}). Choose a delegate to resolve.</p>`
    : '';
  const options = rec.suggestions
    .map((suggestion) => {
      const label = formatSuggestionLabel(suggestion);
      return `<option value="${escapeHtml(suggestion.delegateHash)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  return `
    <form data-enhance="delegation-conflict" action="/delegation/conflict" method="post" class="stack">
      <label>Select delegate for topic "general"</label>
      <select name="delegateHash">
        ${options}
      </select>
      ${conflictNote}
      <input type="hidden" name="topic" value="general" />
      <button class="ghost" type="submit">Use delegate</button>
    </form>
  `;
}

function formatSuggestionLabel(suggestion = {}) {
  const meta = formatSuggestionMeta(suggestion);
  const base = suggestion.delegateHash || 'delegate';
  return meta ? `${base} (${meta})` : base;
}

function formatSuggestionMeta(suggestion = {}) {
  const parts = [];
  if (suggestion.groupId) {
    parts.push(`group ${suggestion.groupId}`);
  }
  const isElection = suggestion.provider === 'group-election' || suggestion.electionId;
  if (isElection) {
    const electionBits = ['election winner'];
    if (suggestion.electionMethod) {
      electionBits.push(`method ${suggestion.electionMethod}`);
    }
    if (suggestion.electionId) {
      electionBits.push(`id ${String(suggestion.electionId).slice(0, 8)}`);
    }
    parts.push(electionBits.join(' - '));
  } else {
    const priority = Number.isFinite(suggestion.priority) ? suggestion.priority : 0;
    parts.push(`priority ${priority}`);
    if (suggestion.provider) {
      parts.push(`source ${suggestion.provider}`);
    }
  }
  return parts.join(' | ');
}

export async function submitPetition({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'petition');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Proposal drafting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_draft', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'petition_draft');
    return sendRateLimit(res, {
      action: 'petition_draft',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const body = await readRequestBody(req);
  const title = sanitizeText(body.title || '', 120);
  const summary = sanitizeText(body.summary || '', 800);
  const proposalText = sanitizeText(body.body || '', 4000);
  const evidenceSummary = sanitizeText(body.evidenceSummary || '', 800);
  const evidenceLinks = parseEvidenceLinks(body.evidenceLinks || '');
  const structuredFields = parseStructuredFields(body);
  // A proposal may live in a group's internal lane. Membership and the lane toggle are both
  // enforced here, so a crafted POST cannot file a proposal inside a group.
  const requestedGroup = readGroupScope(sanitizeText(body.groupId || '', 80));
  const petitionScope = resolveGroupScope(state, person, requestedGroup, { lane: 'petitions' });
  if (!petitionScope.ok) {
    return sendJson(res, petitionScope.error === 'group_not_found' ? 404 : 403, {
      error: petitionScope.error,
      message: petitionScope.message,
    });
  }
  if (
    petitionScope.scoped &&
    !listPostableGroupLanes(state, person, 'petitions').some((g) => g.id === petitionScope.groupId)
  ) {
    return sendJson(res, 403, {
      error: 'group_membership_required',
      message: 'Join the group to file a proposal in its internal lane.',
    });
  }

  const topicResult = await resolvePetitionTopic(state, {
    input: body.topic,
    classifyText: `${title} ${summary} ${proposalText} ${structuredFields.problem} ${structuredFields.proposedAction} ${structuredFields.impact} ${structuredFields.risks} ${structuredFields.implementationPlan}`,
  });
  const { topic, topicPath } = topicResult;

  if (!title || !summary) {
    return sendJson(res, 400, { error: 'missing_fields', message: 'Title and summary are required.' });
  }

  const createdAt = new Date().toISOString();
  const petitionId = randomUUID();
  const governance = getGovernanceSettings(state);
  const quorumInput = body.quorum === undefined || body.quorum === '' ? Number.NaN : Number(body.quorum);
  const quorum = Number.isFinite(quorumInput) ? quorumInput : governance.quorumDefault;
  const petition = {
    id: petitionId,
    title,
    summary,
    body: proposalText,
    evidenceSummary,
    evidenceLinks,
    problem: structuredFields.problem,
    proposedAction: structuredFields.proposedAction,
    impact: structuredFields.impact,
    risks: structuredFields.risks,
    implementationPlan: structuredFields.implementationPlan,
    authorHash: person?.pidHash || 'anonymous',
    createdAt,
    updatedAt: createdAt,
    updatedBy: person?.pidHash || 'anonymous',
    status: 'draft',
    quorum,
    groupId: petitionScope.groupId,
    topic,
    topicId: topicResult.topicId,
    topicPath,
    versions: [
      buildPetitionRevision({
        petitionId,
        title,
        summary,
        body: proposalText,
        person,
        note: 'Initial draft',
        topic,
        topicId: topicResult.topicId,
        topicPath,
        evidenceSummary,
        evidenceLinks,
        problem: structuredFields.problem,
        proposedAction: structuredFields.proposedAction,
        impact: structuredFields.impact,
        risks: structuredFields.risks,
        implementationPlan: structuredFields.implementationPlan,
        createdAt,
      }),
    ],
  };

  const stamped = stampLocalEntry(state, petition);
  state.petitions.unshift(stamped);
  await persistPetitions(state);
  await logTransaction(state, {
    type: 'petition_drafted',
    actorHash: person?.pidHash || 'anonymous',
    petitionId: petition.id,
    payload: { title, topic, summary },
  });
  if (person?.pidHash) {
    await createNotification(state, {
      type: 'petition_created',
      recipientHash: person.pidHash,
      petitionId: petition.id,
      message: `Proposal "${title}" drafted. Topic ${topic}.`,
      expiresAt: null,
    });
  }

  return redirectToProposal(res, petition, 'overview', body);
}

export async function updatePetitionDraft({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'petition');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Proposal drafting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_update', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'petition_update');
    return sendRateLimit(res, {
      action: 'petition_update',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const petition = requirePetitionAction(res, state, person, petitionId);
  if (!petition) return;
  if (!isEditableStage(petition.status)) {
    return sendJson(res, 400, { error: 'petition_locked', message: 'Draft editing is closed once voting opens.' });
  }

  const title = sanitizeText(body.title || petition.title || '', 120);
  const summary = sanitizeText(body.summary || petition.summary || '', 800);
  const proposalText = sanitizeText(body.body || petition.body || '', 4000);
  const evidenceSummaryInput = Object.prototype.hasOwnProperty.call(body, 'evidenceSummary')
    ? body.evidenceSummary
    : petition.evidenceSummary || '';
  const evidenceLinksInput = Object.prototype.hasOwnProperty.call(body, 'evidenceLinks')
    ? body.evidenceLinks
    : petition.evidenceLinks || '';
  const evidenceSummary = sanitizeText(evidenceSummaryInput || '', 800);
  const evidenceLinks = parseEvidenceLinks(evidenceLinksInput || '');
  const structuredFields = parseStructuredFields(body, petition);
  const note = sanitizeText(body.note || '', 240);
  if (!title || !summary) {
    return sendJson(res, 400, { error: 'missing_fields', message: 'Title and summary are required.' });
  }

  const topicResult = await resolvePetitionTopic(state, {
    input: body.topic,
    previous: petition.topic,
    classifyText: `${title} ${summary} ${proposalText} ${structuredFields.problem} ${structuredFields.proposedAction} ${structuredFields.impact} ${structuredFields.risks} ${structuredFields.implementationPlan}`,
  });
  const { topic, topicPath } = topicResult;

  const revision = buildPetitionRevision({
    petitionId,
    title,
    summary,
    body: proposalText,
    person,
    note: note || 'Draft update',
    topic,
    topicId: topicResult.topicId || petition.topicId || null,
    topicPath,
    evidenceSummary,
    evidenceLinks,
    problem: structuredFields.problem,
    proposedAction: structuredFields.proposedAction,
    impact: structuredFields.impact,
    risks: structuredFields.risks,
    implementationPlan: structuredFields.implementationPlan,
  });

  petition.title = title;
  petition.summary = summary;
  petition.body = proposalText;
  petition.evidenceSummary = evidenceSummary;
  petition.evidenceLinks = evidenceLinks;
  petition.problem = structuredFields.problem;
  petition.proposedAction = structuredFields.proposedAction;
  petition.impact = structuredFields.impact;
  petition.risks = structuredFields.risks;
  petition.implementationPlan = structuredFields.implementationPlan;
  petition.topic = topic;
  petition.topicId = topicResult.topicId || petition.topicId || null;
  petition.topicPath = topicPath.length ? topicPath : petition.topicPath || [];
  petition.updatedAt = revision.createdAt;
  petition.updatedBy = revision.authorHash;
  petition.versions = [revision, ...(Array.isArray(petition.versions) ? petition.versions : [])].slice(0, 50);

  await persistPetitions(state);
  await logTransaction(state, {
    type: 'petition_revision',
    actorHash: revision.authorHash,
    petitionId,
    payload: { revisionId: revision.id, note: revision.note || null, topic },
  });

  return redirectToProposal(res, petition, 'overview', body);
}

export async function castVote({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  if (!isModuleEnabled(state, 'votes')) {
    return sendModuleDisabledJson({ res, moduleKey: 'votes', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'vote');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Voting not allowed.' });
  }

  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  let choice = sanitizeText(body.choice || '', 16) || 'abstain';

  const exists = requirePetitionAction(res, state, person, petitionId);
  if (!exists) return;
  if (!isVotingStage(exists.status)) {
    return sendJson(res, 400, { error: 'petition_closed', message: 'Proposal not open for votes.' });
  }

  if (choice === 'auto' && !isModuleEnabled(state, 'delegation')) {
    choice = 'abstain';
  }
  // A delegated ballot is not a choice — it hands the choice to the delegate and stays open
  // until they vote. `delegate` records who holds it and by when, so the tally can resolve it
  // through their vote (transitively) instead of silently counting it as an abstention.
  let delegateBallot = null;
  if (!choice || choice === 'auto') {
    const delegation = resolveDelegation(person, exists.topic, state, {
      notify: (notification) => createNotification(state, notification),
      topicPath: exists.topicPath,
    });
    if (delegation?.delegateHash) {
      const group = exists.groupId ? findGroupById(state, exists.groupId) : null;
      if (group && !canPostToGroupLane(state, { pidHash: delegation.delegateHash }, group, 'petitions')) {
        return sendJson(res, 403, {
          error: 'delegate_outside_group_lane',
          message: 'Your delegate cannot vote in this group lane. Choose a vote yourself or select a delegate who belongs to the group.',
        });
      }
      delegateBallot = buildDelegatedBallot({
        delegateHash: delegation.delegateHash,
        via: delegation.via || 'direct',
        topic: delegation.matchedTopic || exists.topic,
        windowDays: getDelegateVoteWindowDays(state),
      });
      choice = DELEGATED_CHOICE;
    } else {
      choice = 'abstain';
    }
  }

  const policy = getEffectivePolicy(state);
  if (policy.enforceCircle && (!person || !person.pidHash)) {
    const actorLabelPlural = getActorLabels(state).actorLabelPlural;
    return sendJson(res, 401, {
      error: 'strict_requires_verification',
      message: `Strict Circle: only verified ${actorLabelPlural} may vote.`,
    });
  }

  const authorHash = person?.pidHash || 'anonymous';
  // Read who was following this voter *before* the store changes: once their vote lands, a
  // ballot it resolves no longer looks like it was ever waiting.
  const followers = delegateBallot
    ? []
    : listOwnersFollowingDelegate(state, { petitionId, delegateHash: authorHash });
  const vote = {
    petitionId,
    authorHash,
    choice,
    createdAt: new Date().toISOString(),
  };
  if (delegateBallot) {
    vote.delegate = delegateBallot;
  }
  const stamped = stampLocalEntry(state, vote);
  vote.envelope = buildVoteEnvelope({ ...stamped, ...vote }, {
    policy,
    issuer: state.issuer,
    providerBlind: state.settings?.providerBlind,
  });

  // Replace previous vote by same author on the same petition
  const filtered = state.votes.filter((entry) => !(entry.petitionId === petitionId && entry.authorHash === authorHash));
  filtered.unshift({ ...stamped, ...vote });
  state.votes = filtered;
  await persistVotes(state);
  await logTransaction(state, {
    type: 'vote_cast',
    actorHash: authorHash,
    petitionId,
    payload: {
      choice,
      delegate: delegateBallot ? { hash: delegateBallot.hash, via: delegateBallot.via, deadline: delegateBallot.deadline } : null,
      envelope: vote.envelope,
    },
  });
  if (person?.pidHash) {
    await createNotification(state, {
      type: 'vote_recorded',
      recipientHash: person.pidHash,
      petitionId,
      message: delegateBallot
        ? `Ballot on "${exists.title}" delegated to @${resolveHandleForHash(state, delegateBallot.hash)}${describeBallotDeadline(delegateBallot.deadline)}. Vote yourself any time to override.`
        : `Vote recorded for petition "${exists.title}" with choice "${choice}".`,
      expiresAt: null,
    });
  }

  // Tell the delegate a ballot is now riding on them, with the deadline they have to act.
  if (delegateBallot?.hash && delegateBallot.hash !== authorHash) {
    await createNotification(state, {
      type: 'delegated_ballot_received',
      recipientHash: delegateBallot.hash,
      petitionId,
      message: `A member delegated their vote on "${exists.title}" to you${describeBallotDeadline(delegateBallot.deadline)}.`,
      expiresAt: null,
    });
  }

  // Tell everyone whose ballot flows through this voter, so overriding stays their call.
  for (const follower of followers) {
    if (!follower.ownerHash || follower.ownerHash === authorHash ||
        !canReadProposal(state, findSessionByHash(state, follower.ownerHash), exists)) continue;
    await createNotification(state, {
      type: 'delegated_ballot_resolved',
      recipientHash: follower.ownerHash,
      petitionId,
      message: `Your delegate @${resolveHandleForHash(state, authorHash)} voted "${choice}" on "${exists.title}". Vote yourself to override.`,
      expiresAt: null,
    });
  }

  return redirectToProposal(res, exists, 'ballot', body);
}

// " — 5 days to vote" / "" when the deployment runs without a delegate window.
function describeBallotDeadline(deadline) {
  if (!deadline) return '';
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return '';
  const days = Math.max(0, Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24)));
  return ` — ${days} day${days === 1 ? '' : 's'} to vote`;
}

// Move a group's proposal one level up: to the parent group, or to the Circle when the
// group is top level. The proposal keeps its id, so its signatures, comments and votes come
// with it rather than being forked.
export async function promotePetition({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const intent = sanitizeText(body.intent || 'promote', 24);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const entry = requirePetitionAction(res, state, person, petitionId, { requireMembership: false });
  if (!entry) return;

  if (intent === 'promote-request') {
    const request = applyPromotionRequest(state, person, {
      kind: 'petition',
      entry,
      note: sanitizeText(body.note || '', 240),
    });
    if (!request.ok) {
      return sendJson(res, request.error === 'entry_not_found' ? 404 : 403, {
        error: request.error,
        message: request.message,
      });
    }
    await persistPetitions(state);
    await logTransaction(state, {
      type: 'petition_promotion_requested',
      actorHash: person?.pidHash || 'anonymous',
      petitionId,
      payload: { groupId: entry.groupId, targetGroupId: request.targetId },
    });
    for (const hash of listGroupDeciders(request.group)) {
      await createNotification(state, {
        type: 'promotion_requested',
        recipientHash: hash,
        petitionId,
        message: `A member asked to move proposal "${entry.title}" up to ${request.targetLabel}.`,
      });
    }
    return redirectToProposal(res, entry, 'overview');
  }

  if (intent === 'promote-decide') {
    const verdict = sanitizeText(body.decision || 'decline', 16);
    const result = applyPromotionDecision(state, person, {
      kind: 'petition',
      entry,
      decision: verdict,
      reason: sanitizeText(body.reason || '', 240),
    });
    if (!result.ok) {
      return sendJson(res, result.error === 'entry_not_found' ? 404 : 403, {
        error: result.error,
        message: result.message,
      });
    }
    await persistPetitions(state);
    await logTransaction(state, {
      type: result.approved ? 'petition_promoted' : 'petition_promotion_declined',
      actorHash: person?.pidHash || 'anonymous',
      petitionId,
      payload: {
        fromGroupId: result.fromGroupId ?? null,
        toGroupId: result.toGroupId ?? null,
        requestedByHash: result.request?.byHash || null,
      },
    });
    if (result.request?.byHash) {
      await createNotification(state, {
        type: result.approved ? 'promotion_approved' : 'promotion_declined',
        recipientHash: result.request.byHash,
        petitionId,
        message: result.approved
          ? `Your request to move "${entry.title}" up to ${result.request.targetLabel} was approved.`
          : `Your request to move "${entry.title}" up was declined${result.request.reason ? `: ${result.request.reason}` : '.'}`,
      });
    }
    return redirectToProposal(res, entry, 'overview');
  }

  const decision = applyPromotion(state, person, { kind: 'petition', entry });
  if (!decision.ok) {
    return sendJson(res, decision.error === 'entry_not_found' ? 404 : 403, {
      error: decision.error,
      message: decision.message,
    });
  }
  await persistPetitions(state);
  await logTransaction(state, {
    type: 'petition_promoted',
    actorHash: person?.pidHash || 'anonymous',
    petitionId,
    payload: { fromGroupId: decision.fromGroupId, toGroupId: decision.toGroupId },
  });
  await createNotification(state, {
    type: 'petition_promoted',
    recipientHash: entry.authorHash || 'broadcast',
    petitionId,
    message: `Proposal "${entry.title}" was moved up to ${decision.targetLabel}.`,
  });
  return redirectToProposal(res, entry, 'overview');
}

// Group admins and lane moderators — the people who may decide a request.
function listGroupDeciders(group) {
  return (group?.roles || [])
    .filter((entry) => entry.role === 'admin' || entry.role === 'laneModerator')
    .map((entry) => entry.hash)
    .filter(Boolean);
}

export async function updatePetitionStatus({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Moderation not allowed.' });
  }
  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const rawStatus = sanitizeText(body.status || '', 32);
  const status = rawStatus === 'vote' ? 'open' : rawStatus;
  const quorum = Number(body.quorum || 0);
  const validStatus = ['draft', 'discussion', 'open', 'vote', 'closed'];
  if (!validStatus.includes(status)) {
    return sendJson(res, 400, { error: 'invalid_status' });
  }
  const petition = requirePetitionAction(res, state, person, petitionId, { requireMembership: false });
  if (!petition) return;
  const wasVoting = isVotingStage(petition.status);
  const willVote = isVotingStage(status);
  const willClose = status === 'closed';
  if (willVote && !wasVoting) {
    const confirmed = parseBoolean(body.confirmFreeze, false);
    if (!confirmed) {
      return sendJson(res, 400, {
        error: 'vote_freeze_required',
        message: 'Confirm the draft freeze before opening voting.',
      });
    }
    petition.freeze = buildFreezeSnapshot(petition, person);
  } else if (!willVote && !willClose && wasVoting) {
    petition.freeze = null;
  } else if (willVote && !petition.freeze) {
    petition.freeze = buildFreezeSnapshot(petition, person);
  }
  // Closing records when and by whom, so the Ballot can say when voting ended.
  // Any other stage clears it: a reopened vote has not closed yet.
  if (willClose && petition.status !== 'closed') {
    petition.closedAt = new Date().toISOString();
    petition.closedBy = person?.pidHash || 'anonymous';
  } else if (!willClose) {
    petition.closedAt = null;
    petition.closedBy = null;
  }
  petition.status = status;
  petition.quorum = quorum;
  await persistPetitions(state);
  await logTransaction(state, {
    type: 'petition_status',
    actorHash: person?.pidHash || 'anonymous',
    petitionId,
    payload: {
      status,
      quorum,
      freezeRevisionId: petition.freeze?.revisionId || null,
      frozenAt: petition.freeze?.frozenAt || null,
    },
  });

  return redirectToProposal(res, petition, willVote || willClose ? 'ballot' : 'overview', body);
}

export async function signPetitionRoute({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'vote');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Signing not allowed.' });
  }
  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const petition = requirePetitionAction(res, state, person, petitionId);
  if (!petition) return;
  if (hasSigned(petitionId, person, state)) {
    return sendJson(res, 400, { error: 'already_signed' });
  }
  await signPetition({ petition, person, state });
  return redirectToProposal(res, petition, 'overview', body);
}

export async function postPetitionComment({ req, res, state }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_comment', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'petition_comment');
    return sendRateLimit(res, {
      action: 'petition_comment',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }
  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const content = sanitizeText(body.content || '', 800);
  const stance = normalizeCommentStance(body.stance || '');
  const factCheck = parseBoolean(body.factCheck, false);
  const argumentTitle = sanitizeText(body.argumentTitle || '', 120);
  const argumentParentId = sanitizeText(body.argumentParentId || '', 120);
  const evidenceLinks = parseEvidenceLinks(body.evidenceLinks || '');
  if (!petitionId || !content) {
    return sendJson(res, 400, { error: 'missing_fields' });
  }
  const petition = requirePetitionAction(res, state, person, petitionId);
  if (!petition) return;
  if (petition.status === 'closed') {
    return sendJson(res, 400, { error: 'petition_closed', message: 'Discussion closed for this proposal.' });
  }
  const resolvedArgumentParent = argumentParentId
    ? findVisibleEntry(state.discussions, state, (entry) => entry.id === argumentParentId && entry.petitionId === petitionId)
    : null;
  let topicId = petition.topicId || null;
  let topicPath = Array.isArray(petition.topicPath) ? petition.topicPath : [];
  if (!topicId) {
    const fallback = await ensureTopicPath(state, petition.topic || 'general', { source: 'petition' });
    topicId = fallback.topic?.id || null;
    topicPath = fallback.path?.length ? fallback.path.map((entry) => entry.label) : topicPath;
  }
  const entry = {
    id: randomUUID(),
    petitionId,
    topic: petition.topic || 'general',
    topicId,
    topicPath,
    stance,
    content,
    factCheck: Boolean(factCheck),
    argumentTitle,
    argumentParentId: resolvedArgumentParent ? argumentParentId : '',
    evidenceLinks,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  await logTransaction(state, {
    type: 'petition_comment',
    actorHash: person?.pidHash || 'anonymous',
    petitionId,
    payload: {
      petitionId,
      stance,
      factCheck: Boolean(factCheck),
      argumentTitle: argumentTitle || null,
      argumentParentId: resolvedArgumentParent ? argumentParentId : null,
      evidenceLinks,
    },
  });
  await notifyPetitionAuthor(state, { petition, commenter: person, petitionId, content });
  await notifyPetitionMentions(state, { petition, commenter: person, petitionId, content });
  return redirectToProposal(res, petition, 'discussion', body);
}

function groupCommentsByPetition(comments = []) {
  const map = new Map();
  for (const comment of comments) {
    if (!comment.petitionId) continue;
    const list = map.get(comment.petitionId) || [];
    list.push(comment);
    map.set(comment.petitionId, list);
  }
  return map;
}

function buildPetitionLookup(petitions = []) {
  const map = new Map();
  for (const petition of petitions) {
    if (!petition?.id) continue;
    map.set(petition.id, petition);
  }
  return map;
}

function isVotingStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'open' || normalized === 'vote';
}

function getQuorumAdvanceLabel(state) {
  const stage = getQuorumAdvanceStage(state);
  return stage === 'vote' ? 'vote' : 'discussion';
}

async function notifyPetitionAuthor(state, { petition, commenter, petitionId, content }) {
  if (!petition || !petition.authorHash) return;
  if (commenter?.pidHash && petition.authorHash === commenter.pidHash) return;
  const authorSession = findSessionByHash(state, petition.authorHash);
  const commenterLabel = commenter?.handle || 'someone';
  const prefs = resolveNotificationPreferences(state, { sessionId: authorSession?.id, handle: authorSession?.handle });
  if (!prefs.proposalComments || !authorSession || !canReadProposal(state, authorSession, petition)) return;
  await createNotificationWithOutbound(
    state,
    {
      type: 'petition_comment',
      recipientHash: petition.authorHash,
      petitionId,
      message: `New comment on proposal "${petition.title}" from ${commenterLabel}.`,
    },
    { sessionId: authorSession?.id, handle: authorSession?.handle },
  );
}

async function notifyPetitionMentions(state, { petition, commenter, petitionId, content }) {
  const mentions = extractMentions(content || '');
  if (!mentions.length) return;
  const recipients = new Map();
  for (const handle of mentions) {
    const session = findSessionByHandle(state, handle);
    if (!session || !canReadProposal(state, session, petition)) continue;
    if (commenter?.pidHash && session.pidHash === commenter.pidHash) continue;
    if (recipients.has(session.pidHash)) continue;
    const prefs = resolveNotificationPreferences(state, { sessionId: session.id, handle: session.handle });
    if (!prefs.proposalComments) continue;
    recipients.set(session.pidHash, { sessionId: session.id, handle: session.handle });
  }
  for (const [recipientHash, recipient] of recipients.entries()) {
    await createNotificationWithOutbound(
      state,
      {
        type: 'petition_comment_mention',
        recipientHash,
        petitionId,
        message: `Mention in proposal "${petition.title}" discussion by ${commenter?.handle || 'someone'}.`,
      },
      { sessionId: recipient.sessionId, handle: recipient.handle },
    );
  }
}

function normalizeStageFilter(value) {
  const normalized = String(value || '').toLowerCase();
  const allowed = new Set(['all', 'draft', 'discussion', 'vote', 'open', 'closed']);
  if (!allowed.has(normalized)) return 'all';
  return normalized === 'open' ? 'vote' : normalized;
}

function filterPetitionsByStage(petitions = [], stageFilter = 'all') {
  if (stageFilter === 'all') return petitions;
  return petitions.filter((petition) => normalizeStageFilter(petition.status) === stageFilter);
}

function renderStageFilterOptions(selected = 'all') {
  const options = [
    { value: 'all', label: 'All stages' },
    { value: 'discussion', label: 'Discussion' },
    { value: 'vote', label: 'Vote' },
    { value: 'draft', label: 'Draft' },
    { value: 'closed', label: 'Closed' },
  ];
  return options
    .map((option) => {
      const chosen = selected === option.value ? ' selected' : '';
      return `<option value="${option.value}"${chosen}>${option.label}</option>`;
    })
    .join('\n');
}

function buildDiscussionFeedItems(comments = [], petitionLookup) {
  const items = [];
  for (const comment of comments) {
    const petition = petitionLookup.get(comment.petitionId);
    if (!petition) continue;
    items.push({ comment, petition });
  }
  return items.sort((a, b) => Date.parse(b.comment.createdAt) - Date.parse(a.comment.createdAt)).slice(0, 30);
}

function buildPetitionRevision({
  petitionId,
  title,
  summary,
  body,
  evidenceSummary,
  evidenceLinks,
  problem,
  proposedAction,
  impact,
  risks,
  implementationPlan,
  person,
  note,
  topic,
  topicId,
  topicPath,
  createdAt,
} = {}) {
  return {
    id: randomUUID(),
    petitionId,
    title,
    summary,
    body,
    evidenceSummary: evidenceSummary || '',
    evidenceLinks: Array.isArray(evidenceLinks) ? evidenceLinks : [],
    problem: problem || '',
    proposedAction: proposedAction || '',
    impact: impact || '',
    risks: risks || '',
    implementationPlan: implementationPlan || '',
    note: note || '',
    authorHash: person?.pidHash || 'anonymous',
    authorHandle: person?.handle || null,
    topic,
    topicId: topicId || null,
    topicPath: Array.isArray(topicPath) ? topicPath : [],
    createdAt: createdAt || new Date().toISOString(),
  };
}

function isEditableStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'draft' || normalized === 'discussion';
}

function parseStructuredFields(body = {}, fallback = {}) {
  return {
    problem: readOptionalField(body, 'problem', fallback.problem, 800),
    proposedAction: readOptionalField(body, 'proposedAction', fallback.proposedAction, 800),
    impact: readOptionalField(body, 'impact', fallback.impact, 800),
    risks: readOptionalField(body, 'risks', fallback.risks, 800),
    implementationPlan: readOptionalField(body, 'implementationPlan', fallback.implementationPlan, 800),
  };
}

function readOptionalField(body, key, fallback, limit) {
  const hasValue = Object.prototype.hasOwnProperty.call(body, key);
  const source = hasValue ? body[key] : fallback || '';
  return sanitizeText(source || '', limit);
}
