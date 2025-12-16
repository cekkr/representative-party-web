import { randomUUID } from 'node:crypto';

import { getCitizen } from '../services/citizen.js';
import { classifyTopic } from '../services/classification.js';
import { resolveDelegation } from '../services/delegation.js';
import { evaluateAction, getEffectivePolicy } from '../services/policy.js';
import { createNotification } from '../services/notifications.js';
import { persistPetitions, persistVotes } from '../state/storage.js';
import { sendHtml, sendJson, sendRedirect } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';
import { renderPetitionList } from '../views/petitionView.js';
import { renderPage } from '../views/templates.js';

export async function renderPetitions({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const petitionGate = evaluateAction(state, citizen, 'petition');
  const voteGate = evaluateAction(state, citizen, 'vote');
  const moderateGate = evaluateAction(state, citizen, 'moderate');
  const html = await renderPage(
    'petitions',
    {
      citizenHandle: citizen?.handle || 'Not verified yet',
      petitionStatus: petitionGate.allowed ? 'You can draft petitions.' : petitionGate.message || petitionGate.reason,
      voteStatus: voteGate.allowed ? 'You can vote on petitions.' : voteGate.message || voteGate.reason,
      petitionGateReason: petitionGate.message || '',
      voteGateReason: voteGate.message || '',
      roleLabel: citizen?.role || 'guest',
      petitionsList: renderPetitionList(state.petitions, state.votes, moderateGate.allowed),
    },
    { wantsPartial, title: 'Petitions & Votes' },
  );
  return sendHtml(res, html);
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
  const topic = classifyTopic(`${title} ${summary}`, state);

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

  state.petitions.unshift(petition);
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

  // Replace previous vote by same author on the same petition
  const filtered = state.votes.filter((entry) => !(entry.petitionId === petitionId && entry.authorHash === authorHash));
  filtered.unshift(vote);
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
