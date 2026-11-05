import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { classifyTopic } from '../../topics/classification.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { resolveDelegation } from '../../delegation/delegation.js';
import { recommendDelegationForPerson } from '../../groups/groups.js';
import { evaluateAction, getEffectivePolicy } from '../../circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { createNotification, createNotificationWithOutbound } from '../../messaging/notifications.js';
import { persistDiscussions, persistPetitions, persistVotes } from '../../../infra/persistence/storage.js';
import { countSignatures, getQuorumAdvanceStage, hasSigned, signPetition } from '../../petitions/signatures.js';
import { resolveNotificationPreferences } from '../../messaging/outbound.js';
import { extractMentions } from '../../social/posts.js';
import { findSessionByHandle, findSessionByHash } from '../../identity/sessions.js';
import { buildVoteEnvelope } from '../../votes/voteEnvelope.js';
import { filterVisibleEntries, stampLocalEntry } from '../../federation/replication.js';
import { logTransaction } from '../../transactions/registry.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { renderPetitionList, renderProposalDiscussionFeed } from '../../../interfaces/http/views/petitionView.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { getActorLabels, resolveHandleForHash, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderContextPanel } from '../../../interfaces/http/views/contextPanel.js';
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
  const modules = resolveModuleSettings(state);
  const petitionGate = evaluateAction(state, person, 'petition');
  const voteGate = modules.votes
    ? evaluateAction(state, person, 'vote')
    : { allowed: false, reason: 'module_disabled', message: 'Voting module disabled.' };
  const moderateGate = evaluateAction(state, person, 'moderate');
  const delegationEnabled = modules.delegation;
  const groupsEnabled = modules.groups;
  const showDelegation = delegationEnabled && groupsEnabled;
  const signatures = filterVisibleEntries(state.signatures, state);
  const delegations = filterVisibleEntries(state.delegations, state);
  const petitionComments = filterVisibleEntries(state.discussions, state, (entry) => Boolean(entry.petitionId));
  const commentsByPetition = groupCommentsByPetition(petitionComments);
  const conflicts = delegationEnabled ? delegations?.filter((d) => d.conflict) || [] : [];
  let suggestions = 'Delegation module disabled.';
  if (delegationEnabled && !groupsEnabled) {
    suggestions = 'Group suggestions unavailable (groups disabled).';
  } else if (showDelegation) {
    suggestions = renderSuggestions(person, state);
  }
  const query = url || new URL(req.url, `http://${req.headers.host}`);
  const scope = resolveGroupScope(state, person, readGroupScope(query.searchParams), { lane: 'petitions' });
  // A refused scope falls back to Circle level with the reason shown, rather than an empty
  // list that reads as "this group has no proposals".
  const activeGroupId = scope.ok ? scope.groupId : null;
  const scopeNotice = scope.ok ? '' : scope.message;
  const petitions = filterVisibleEntries(state.petitions, state, (entry) =>
    matchesGroupScope(entry, activeGroupId),
  );
  const votes = filterVisibleEntries(state.votes, state);
  const quorumAdvanceLabel = getQuorumAdvanceLabel(state);
  const governance = getGovernanceSettings(state);
  const stageFilter = normalizeStageFilter(query.searchParams.get('stage') || 'all');
  const composeOpen = query.searchParams.get('compose') ? 'open' : '';
  const filteredPetitions = filterPetitionsByStage(petitions, stageFilter);
  const petitionsPageInfo = paginate(filteredPetitions, { page: parsePage(query.searchParams.get('page')) });
  const petitionsPager = renderPager(petitionsPageInfo, {
    baseHref: '/petitions',
    query: { stage: stageFilter === 'all' ? '' : stageFilter, group: activeGroupId || '' },
    label: 'proposals',
  });
  const petitionLookup = buildPetitionLookup(petitions);
  const discussionFeedItems = buildDiscussionFeedItems(petitionComments, petitionLookup, stageFilter);
  const stageFilterOptions = renderStageFilterOptions(stageFilter);
  const actorLabels = getActorLabels(state);
  const composeParams = new URLSearchParams({ compose: 'proposal' });
  if (activeGroupId) composeParams.set('group', activeGroupId);
  if (stageFilter !== 'all') composeParams.set('stage', stageFilter);
  const canCompose = petitionGate.allowed && canPostToGroupLane(state, person, scope.ok ? scope.group : null, 'petitions');
  const html = await renderPage(
    'petitions',
    {
      person,
      personHandle: resolvePersonHandle(person),
      workspaceCreateHref: canCompose ? `/petitions?${composeParams}#petitions-compose` : '',
      petitionsContext: renderContextPanel({
        gates: [
          {
            label: 'Draft proposals',
            status: petitionGate.allowed ? 'Allowed' : 'Blocked',
            allowed: petitionGate.allowed,
            reason: petitionGate.allowed ? '' : petitionGate.message || petitionGate.reason,
          },
          {
            label: 'Vote on proposals',
            status: voteGate.allowed ? 'Allowed' : 'Blocked',
            allowed: voteGate.allowed,
            reason: voteGate.allowed ? '' : voteGate.message || voteGate.reason,
          },
        ],
        facts: [
          { term: 'Role', value: person?.role || 'guest' },
          { term: 'Handle', value: resolvePersonHandle(person) || 'Not signed in' },
          { term: 'Quorum advances to', value: quorumAdvanceLabel },
          {
            term: 'Delegation conflicts',
            value: delegationEnabled
              ? conflicts.map((c) => c.topic).join(', ') || 'None detected'
              : 'Delegation disabled',
          },
        ],
        guidance: [
          'Use proposals when you need a decision; discussion and social lanes stay exploratory.',
          'Circle policy governs quorum and votes; group cachets inform delegation only.',
        ],
      }),
      petitionsList: renderPetitionList(petitionsPageInfo.items, votes, signatures, person, moderateGate.allowed, commentsByPetition, {
        allowDelegation: delegationEnabled,
        allowVoting: modules.votes,
        allowEditing: petitionGate.allowed,
        editGate: petitionGate,
        actorLabels,
        state,
        groupId: activeGroupId,
        promotable: (entry) => evaluatePromotion(state, person, { kind: 'petition', entry }),
        requestable: (entry) => evaluatePromotionRequest(state, person, { kind: 'petition', entry }),
        decidable: (entry) => evaluatePromotionDecision(state, person, { kind: 'petition', entry }),
      }),
      petitionsPager,
      petitionsScopeTabs: renderPetitionScopeTabs({ state, person, activeGroupId }),
      petitionsScopeNotice: scopeNotice ? `<p class="muted small">${escapeHtml(scopeNotice)}</p>` : '',
      petitionsGroupPicker: renderPetitionGroupPicker(state, person, activeGroupId),
      topicDatalist: renderTopicDatalist(
        buildTopicOptions({
          anchors: getTopicConfig(state).anchors,
          pinned: getTopicConfig(state).pinned,
          preferences: getTopicPreferences(state, person),
          entries: petitions,
        }),
      ),
      delegationSuggestions: suggestions,
      quorumAdvanceLabel,
      quorumDefault: governance.quorumDefault,
      discussionFeed: renderProposalDiscussionFeed(discussionFeedItems, state),
      stageFilterOptions,
      composeOpen,
    },
    { wantsPartial, title: 'Proposals & Votes', state },
  );
  return sendHtml(res, html);
}

function renderPetitionScopeTabs({ state, person, activeGroupId }) {
  const groups = listReadableGroupLanes(state, person, 'petitions');
  if (!groups.length) return '';
  const tab = (href, label, active) =>
    `<a class="pill ${active ? '' : 'ghost'}" href="${escapeHtml(href)}" data-partial>${escapeHtml(label)}</a>`;
  const tabs = [tab('/petitions', 'Whole Circle', !activeGroupId)];
  for (const group of groups) {
    tabs.push(
      tab(`/petitions?group=${encodeURIComponent(group.id)}`, group.name || 'Group', activeGroupId === group.id),
    );
  }
  return `<div class="discussion__meta">${tabs.join('')}</div>`;
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

export async function submitPetition({ req, res, state, wantsPartial }) {
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

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }

  return sendRedirect(res, '/petitions');
}

export async function updatePetitionDraft({ req, res, state, wantsPartial }) {
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
  const petition = state.petitions.find((p) => p.id === petitionId);
  if (!petition) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
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

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }

  return sendRedirect(res, '/petitions');
}

export async function castVote({ req, res, state, wantsPartial }) {
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

  const exists = state.petitions.find((p) => p.id === petitionId);
  if (!exists) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
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
    if (!follower.ownerHash || follower.ownerHash === authorHash) continue;
    await createNotification(state, {
      type: 'delegated_ballot_resolved',
      recipientHash: follower.ownerHash,
      petitionId,
      message: `Your delegate @${resolveHandleForHash(state, authorHash)} voted "${choice}" on "${exists.title}". Vote yourself to override.`,
      expiresAt: null,
    });
  }

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }

  return sendRedirect(res, '/petitions');
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
export async function promotePetition({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const intent = sanitizeText(body.intent || 'promote', 24);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const entry = (state.petitions || []).find((item) => item.id === petitionId);

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
    return finishPetitionPromotion({ req, res, state, wantsPartial, groupId: entry.groupId });
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
    return finishPetitionPromotion({
      req,
      res,
      state,
      wantsPartial,
      groupId: result.approved ? result.toGroupId : entry.groupId,
    });
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
  return finishPetitionPromotion({ req, res, state, wantsPartial, groupId: decision.toGroupId });
}

async function finishPetitionPromotion({ req, res, state, wantsPartial, groupId }) {
  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }
  return sendRedirect(res, groupId ? `/petitions?group=${encodeURIComponent(groupId)}` : '/petitions');
}

// Group admins and lane moderators — the people who may decide a request.
function listGroupDeciders(group) {
  return (group?.roles || [])
    .filter((entry) => entry.role === 'admin' || entry.role === 'laneModerator')
    .map((entry) => entry.hash)
    .filter(Boolean);
}

export async function updatePetitionStatus({ req, res, state, wantsPartial }) {
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
  const petition = state.petitions.find((p) => p.id === petitionId);
  if (!petition) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
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

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }
  return sendRedirect(res, '/petitions');
}

export async function signPetitionRoute({ req, res, state, wantsPartial }) {
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
  const petition = state.petitions.find((p) => p.id === petitionId);
  if (!petition) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
  if (hasSigned(petitionId, person, state)) {
    return sendJson(res, 400, { error: 'already_signed' });
  }
  await signPetition({ petition, person, state });
  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }
  return sendRedirect(res, '/petitions');
}

export async function postPetitionComment({ req, res, state, wantsPartial, url }) {
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
  const petition = state.petitions.find((p) => p.id === petitionId);
  if (!petition) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
  if (petition.status === 'closed') {
    return sendJson(res, 400, { error: 'petition_closed', message: 'Discussion closed for this proposal.' });
  }
  const resolvedArgumentParent = argumentParentId
    ? state.discussions.find((entry) => entry.id === argumentParentId && entry.petitionId === petitionId)
    : null;
  const argumentTitleFinal = argumentTitle || (resolvedArgumentParent ? 'Argument note' : '');
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
    argumentTitle: argumentTitleFinal,
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
      argumentTitle: argumentTitleFinal || null,
      argumentParentId: resolvedArgumentParent ? argumentParentId : null,
      evidenceLinks,
    },
  });
  await notifyPetitionAuthor(state, { petition, commenter: person, petitionId, content });
  await notifyPetitionMentions(state, { petition, commenter: person, petitionId, content });
  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true, url });
  }
  return sendRedirect(res, '/petitions');
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
  if (!prefs.proposalComments) return;
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
    if (!session) continue;
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

function buildDiscussionFeedItems(comments = [], petitionLookup, stageFilter) {
  const items = [];
  for (const comment of comments) {
    const petition = petitionLookup.get(comment.petitionId);
    if (!petition) continue;
    const petitionStage = normalizeStageFilter(petition.status);
    if (stageFilter !== 'all' && petitionStage !== stageFilter) continue;
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

function buildFreezeSnapshot(petition, person) {
  const latest = Array.isArray(petition?.versions) ? petition.versions[0] : null;
  const source = latest || petition || {};
  return {
    revisionId: latest?.id || null,
    frozenAt: new Date().toISOString(),
    frozenBy: person?.pidHash || 'anonymous',
    title: source.title || petition.title || '',
    summary: source.summary || petition.summary || '',
    body: source.body || petition.body || '',
    evidenceSummary: source.evidenceSummary || petition.evidenceSummary || '',
    evidenceLinks: Array.isArray(source.evidenceLinks) ? source.evidenceLinks : petition.evidenceLinks || [],
    problem: source.problem || petition.problem || '',
    proposedAction: source.proposedAction || petition.proposedAction || '',
    impact: source.impact || petition.impact || '',
    risks: source.risks || petition.risks || '',
    implementationPlan: source.implementationPlan || petition.implementationPlan || '',
    topic: source.topic || petition.topic || 'general',
    topicId: source.topicId || petition.topicId || null,
    topicPath: Array.isArray(source.topicPath)
      ? source.topicPath
      : Array.isArray(petition.topicPath)
        ? petition.topicPath
        : [],
  };
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
