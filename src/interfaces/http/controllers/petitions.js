import { randomUUID } from 'node:crypto';

import { getCitizen } from '../../modules/identity/citizen.js';
import { classifyTopic } from '../../modules/topics/classification.js';
import { resolveDelegation } from '../../modules/delegation/delegation.js';
import { recommendDelegationForCitizen } from '../../modules/groups/groups.js';
import { evaluateAction, getEffectivePolicy } from '../../modules/circle/policy.js';
import { createNotification } from '../../modules/messaging/notifications.js';
import { persistPetitions, persistVotes } from '../../infra/persistence/storage.js';
import { countSignatures, hasSigned, signPetition } from '../../modules/petitions/signatures.js';
import { buildVoteEnvelope } from '../../modules/votes/voteEnvelope.js';
import { filterVisibleEntries, stampLocalEntry } from '../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRedirect } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderPetitionList } from '../views/petitionView.js';
import { renderPage } from '../views/templates.js';

export async function renderPetitions({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const petitionGate = evaluateAction(state, citizen, 'petition');
  const voteGate = evaluateAction(state, citizen, 'vote');
  const moderateGate = evaluateAction(state, citizen, 'moderate');
  const signatures = filterVisibleEntries(state.signatures, state);
  const delegations = filterVisibleEntries(state.delegations, state);
  const conflicts = delegations?.filter((d) => d.conflict) || [];
  const suggestions = renderSuggestions(citizen, state);
  const petitions = filterVisibleEntries(state.petitions, state);
  const votes = filterVisibleEntries(state.votes, state);
  const html = await renderPage(
    'petitions',
    {
      citizenHandle: citizen?.handle || 'Not verified yet',
      petitionStatus: petitionGate.allowed ? 'You can draft petitions.' : petitionGate.message || petitionGate.reason,
      voteStatus: voteGate.allowed ? 'You can vote on petitions.' : voteGate.message || voteGate.reason,
      petitionGateReason: petitionGate.message || '',
      voteGateReason: voteGate.message || '',
      roleLabel: citizen?.role || 'guest',
      petitionsList: renderPetitionList(petitions, votes, signatures, citizen, moderateGate.allowed),
      conflictList: conflicts.map((c) => c.topic).join(', ') || 'No conflicts detected',
      delegationSuggestions: suggestions,
    },
    { wantsPartial, title: 'Petitions & Votes' },
  );
  return sendHtml(res, html);
}

function renderSuggestions(citizen, state) {
  if (!citizen) return 'Login to see group delegate suggestions.';
  const rec = recommendDelegationForCitizen(citizen, 'general', state);
  if (!rec.suggestions || !rec.suggestions.length) return 'No suggestions.';
  return `
    <form data-enhance="delegation-conflict" action="/delegation/conflict" method="post" class="stack">
      <label>Select delegate for topic "general"</label>
      <select name="delegateHash">
        ${rec.suggestions
          .map((s) => `<option value="${s.delegateHash}">${s.delegateHash} (prio ${s.priority} via group ${s.groupId || ''})</option>`)
          .join('')}
      </select>
      <input type="hidden" name="topic" value="general" />
      <button class="ghost" type="submit">Use delegate</button>
    </form>
  `;
}

export async function submitPetition({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'petition');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Petitioning not allowed.' });
  }

  const body = await readRequestBody(req);
  const title = sanitizeText(body.title || '', 120);
  const summary = sanitizeText(body.summary || '', 800);
  const topic = await classifyTopic(`${title} ${summary}`, state);

  if (!title || !summary) {
    return sendJson(res, 400, { error: 'missing_fields', message: 'Title and summary are required.' });
  }

  const petition = {
    id: randomUUID(),
    title,
    summary,
    authorHash: citizen?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    status: 'draft',
    quorum: Number(body.quorum || 0),
    topic,
  };

  const stamped = stampLocalEntry(state, petition);
  state.petitions.unshift(stamped);
  await persistPetitions(state);
  if (citizen?.pidHash) {
    await createNotification(state, {
      type: 'petition_created',
      recipientHash: citizen.pidHash,
      petitionId: petition.id,
      message: `Petition "${title}" drafted. Topic ${topic}.`,
      expiresAt: null,
    });
  }

  if (wantsPartial) {
    const html = await renderPetitions({ req, res, state, wantsPartial: true });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/petitions');
}

export async function castVote({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'vote');
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
  if (exists.status !== 'open') {
    return sendJson(res, 400, { error: 'petition_closed', message: 'Petition not open for votes.' });
  }

  if (!choice || choice === 'auto') {
    const delegation = resolveDelegation(citizen, exists.topic, state, {
      notify: (notification) => createNotification(state, notification),
    });
    if (delegation) {
      choice = `delegate:${delegation.delegateHash}`;
    } else {
      choice = 'abstain';
    }
  }

  const policy = getEffectivePolicy(state);
  if (policy.enforceCircle && (!citizen || !citizen.pidHash)) {
    return sendJson(res, 401, { error: 'strict_requires_verification', message: 'Strict Circle: only verified citizens may vote.' });
  }

  const authorHash = citizen?.pidHash || 'anonymous';
  const vote = {
    petitionId,
    authorHash,
    choice,
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, vote);
  vote.envelope = buildVoteEnvelope({ ...stamped, ...vote });

  // Replace previous vote by same author on the same petition
  const filtered = state.votes.filter((entry) => !(entry.petitionId === petitionId && entry.authorHash === authorHash));
  filtered.unshift({ ...stamped, ...vote });
  state.votes = filtered;
  await persistVotes(state);
  if (citizen?.pidHash) {
    await createNotification(state, {
      type: 'vote_recorded',
      recipientHash: citizen.pidHash,
      petitionId,
      message: `Vote recorded for petition "${exists.title}" with choice "${choice}".`,
      expiresAt: null,
    });
  }

  if (wantsPartial) {
    const html = await renderPetitions({ req, res, state, wantsPartial: true });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/petitions');
}

export async function updatePetitionStatus({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'moderate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Moderation not allowed.' });
  }
  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const status = sanitizeText(body.status || '', 32);
  const quorum = Number(body.quorum || 0);
  const validStatus = ['draft', 'open', 'closed'];
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

  if (wantsPartial) {
    const html = await renderPetitions({ req, res, state, wantsPartial: true });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/petitions');
}

export async function signPetitionRoute({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'vote');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Signing not allowed.' });
  }
  const body = await readRequestBody(req);
  const petitionId = sanitizeText(body.petitionId || '', 120);
  const petition = state.petitions.find((p) => p.id === petitionId);
  if (!petition) {
    return sendJson(res, 404, { error: 'petition_not_found' });
  }
  if (hasSigned(petitionId, citizen, state)) {
    return sendJson(res, 400, { error: 'already_signed' });
  }
  await signPetition({ petition, citizen, state });
  if (wantsPartial) {
    const html = await renderPetitions({ req, res, state, wantsPartial: true });
    return sendHtml(res, html);
  }
  return sendRedirect(res, '/petitions');
}
