import { randomUUID } from 'node:crypto';

import { getPerson } from '../../../modules/identity/person.js';
import { classifyTopic } from '../../../modules/topics/classification.js';
import { ensureTopicPath } from '../../../modules/topics/registry.js';
import { resolveDelegation } from '../../../modules/delegation/delegation.js';
import { recommendDelegationForPerson } from '../../../modules/groups/groups.js';
import { evaluateAction, getEffectivePolicy } from '../../../modules/circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../../modules/circle/modules.js';
import { createNotification, createNotificationWithOutbound } from '../../../modules/messaging/notifications.js';
import { persistDiscussions, persistPetitions, persistVotes } from '../../../infra/persistence/storage.js';
import { countSignatures, getQuorumAdvanceStage, hasSigned, signPetition } from '../../../modules/petitions/signatures.js';
import { resolveNotificationPreferences } from '../../../modules/messaging/outbound.js';
import { extractMentions } from '../../../modules/social/posts.js';
import { findSessionByHandle } from '../../../modules/social/followGraph.js';
import { buildVoteEnvelope } from '../../../modules/votes/voteEnvelope.js';
import { filterVisibleEntries, stampLocalEntry } from '../../../modules/federation/replication.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { renderPetitionList, renderProposalDiscussionFeed } from '../views/petitionView.js';
import { getActorLabels } from '../views/actorLabel.js';
import { renderPage } from '../views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../../modules/identity/rateLimit.js';

export async function renderPetitions({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'petitions' });
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
  const discussionEntries = filterVisibleEntries(state.discussions, state);
  const petitionComments = discussionEntries.filter((entry) => entry.petitionId);
  const commentsByPetition = groupCommentsByPetition(petitionComments);
  const conflicts = delegationEnabled ? delegations?.filter((d) => d.conflict) || [] : [];
  let suggestions = 'Delegation module disabled.';
  if (delegationEnabled && !groupsEnabled) {
    suggestions = 'Group suggestions unavailable (groups disabled).';
  } else if (showDelegation) {
    suggestions = renderSuggestions(person, state);
  }
  const petitions = filterVisibleEntries(state.petitions, state);
  const votes = filterVisibleEntries(state.votes, state);
  const quorumAdvanceLabel = getQuorumAdvanceLabel(state);
  const query = url || new URL(req.url, `http://${req.headers.host}`);
  const stageFilter = normalizeStageFilter(query.searchParams.get('stage') || 'all');
  const filteredPetitions = filterPetitionsByStage(petitions, stageFilter);
  const petitionLookup = buildPetitionLookup(petitions);
  const discussionFeedItems = buildDiscussionFeedItems(petitionComments, petitionLookup, stageFilter);
  const stageFilterOptions = renderStageFilterOptions(stageFilter);
  const actorLabels = getActorLabels(state);
  const html = await renderPage(
    'petitions',
    {
      personHandle: person?.handle || 'Not verified yet',
      petitionStatus: petitionGate.allowed ? 'You can draft proposals.' : petitionGate.message || petitionGate.reason,
      voteStatus: voteGate.allowed ? 'You can vote on proposals.' : voteGate.message || voteGate.reason,
      petitionGateReason: petitionGate.message || '',
      voteGateReason: voteGate.message || '',
      roleLabel: person?.role || 'guest',
      petitionsList: renderPetitionList(filteredPetitions, votes, signatures, person, moderateGate.allowed, commentsByPetition, {
        allowDelegation: delegationEnabled,
        allowVoting: modules.votes,
        allowEditing: petitionGate.allowed,
        editGate: petitionGate,
        actorLabels,
        state,
      }),
      conflictList: delegationEnabled ? conflicts.map((c) => c.topic).join(', ') || 'No conflicts detected' : 'Delegation disabled.',
      delegationSuggestions: suggestions,
      quorumAdvanceLabel,
      discussionFeed: renderProposalDiscussionFeed(discussionFeedItems),
      stageFilterOptions,
    },
    { wantsPartial, title: 'Proposals & Votes', state },
  );
  return sendHtml(res, html);
}

function renderSuggestions(person, state) {
  if (!person) return 'Login to see group delegate suggestions.';
  const rec = recommendDelegationForPerson(person, 'general', state);
  if (!rec.suggestions || !rec.suggestions.length) return 'No suggestions.';
  const conflictNote = rec.conflict
    ? `<p class="muted small">Conflict detected (${rec.conflictRule || 'highest_priority'}). Choose a delegate to resolve.</p>`
    : '';
  return `
    <form data-enhance="delegation-conflict" action="/delegation/conflict" method="post" class="stack">
      <label>Select delegate for topic "general"</label>
      <select name="delegateHash">
        ${rec.suggestions
          .map((s) => `<option value="${s.delegateHash}">${s.delegateHash} (prio ${s.priority} via group ${s.groupId || ''})</option>`)
          .join('')}
      </select>
      ${conflictNote}
      <input type="hidden" name="topic" value="general" />
      <button class="ghost" type="submit">Use delegate</button>
    </form>
  `;
}

export async function submitPetition({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'petition');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Proposal drafting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_draft', actorKey });
  if (!rateLimit.allowed) {
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
  const classifiedTopic = await classifyTopic(`${title} ${summary} ${proposalText}`, state);
  const topicResult = await ensureTopicPath(state, classifiedTopic, { source: 'petition' });
  const topic = topicResult.topic?.label || classifiedTopic || 'general';
  const topicPath = topicResult.path?.length ? topicResult.path.map((entry) => entry.label) : [];

  if (!title || !summary) {
    return sendJson(res, 400, { error: 'missing_fields', message: 'Title and summary are required.' });
  }

  const createdAt = new Date().toISOString();
  const petitionId = randomUUID();
  const petition = {
    id: petitionId,
    title,
    summary,
    body: proposalText,
    authorHash: person?.pidHash || 'anonymous',
    createdAt,
    updatedAt: createdAt,
    updatedBy: person?.pidHash || 'anonymous',
    status: 'draft',
    quorum: Number(body.quorum || 0),
    topic,
    topicId: topicResult.topic?.id || null,
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
        topicId: topicResult.topic?.id || null,
        topicPath,
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
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'petition');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Proposal drafting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_update', actorKey });
  if (!rateLimit.allowed) {
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
  const note = sanitizeText(body.note || '', 240);
  if (!title || !summary) {
    return sendJson(res, 400, { error: 'missing_fields', message: 'Title and summary are required.' });
  }

  const classifiedTopic = await classifyTopic(`${title} ${summary} ${proposalText}`, state);
  const topicResult = await ensureTopicPath(state, classifiedTopic, { source: 'petition' });
  const topic = topicResult.topic?.label || classifiedTopic || petition.topic || 'general';
  const topicPath = topicResult.path?.length ? topicResult.path.map((entry) => entry.label) : [];

  const revision = buildPetitionRevision({
    petitionId,
    title,
    summary,
    body: proposalText,
    person,
    note: note || 'Draft update',
    topic,
    topicId: topicResult.topic?.id || petition.topicId || null,
    topicPath,
  });

  petition.title = title;
  petition.summary = summary;
  petition.body = proposalText;
  petition.topic = topic;
  petition.topicId = topicResult.topic?.id || petition.topicId || null;
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
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
  }
  if (!isModuleEnabled(state, 'votes')) {
    return sendModuleDisabledJson({ res, moduleKey: 'votes' });
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
  if (!choice || choice === 'auto') {
    const delegation = resolveDelegation(person, exists.topic, state, {
      notify: (notification) => createNotification(state, notification),
    });
    if (delegation) {
      choice = `delegate:${delegation.delegateHash}`;
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
  const vote = {
    petitionId,
    authorHash,
    choice,
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, vote);
  vote.envelope = buildVoteEnvelope({ ...stamped, ...vote }, { policy, issuer: state.issuer });

  // Replace previous vote by same author on the same petition
  const filtered = state.votes.filter((entry) => !(entry.petitionId === petitionId && entry.authorHash === authorHash));
  filtered.unshift({ ...stamped, ...vote });
  state.votes = filtered;
  await persistVotes(state);
  await logTransaction(state, {
    type: 'vote_cast',
    actorHash: authorHash,
    petitionId,
    payload: { choice, envelope: vote.envelope },
  });
  if (person?.pidHash) {
    await createNotification(state, {
      type: 'vote_recorded',
      recipientHash: person.pidHash,
      petitionId,
      message: `Vote recorded for petition "${exists.title}" with choice "${choice}".`,
      expiresAt: null,
    });
  }

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }

  return sendRedirect(res, '/petitions');
}

export async function updatePetitionStatus({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
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
  petition.status = status;
  petition.quorum = quorum;
  await persistPetitions(state);
  await logTransaction(state, {
    type: 'petition_status',
    actorHash: person?.pidHash || 'anonymous',
    petitionId,
    payload: { status, quorum },
  });

  if (wantsPartial) {
    return renderPetitions({ req, res, state, wantsPartial: true });
  }
  return sendRedirect(res, '/petitions');
}

export async function signPetitionRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'petitions')) {
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
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
    return sendModuleDisabledJson({ res, moduleKey: 'petitions' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Posting not allowed.' });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'petition_comment', actorKey });
  if (!rateLimit.allowed) {
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
    stance: 'comment',
    content,
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
    payload: { petitionId },
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

function findSessionByHash(state, pidHash) {
  if (!pidHash || !state?.sessions) return null;
  for (const session of state.sessions.values()) {
    if (session.pidHash === pidHash) return session;
  }
  return null;
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
