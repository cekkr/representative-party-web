import { randomUUID } from 'node:crypto';

import { getCitizen } from '../services/citizen.js';
import { evaluateAction } from '../services/policy.js';
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
  const html = await renderPage(
    'petitions',
    {
      citizenHandle: citizen?.handle || 'Not verified yet',
      petitionStatus: petitionGate.allowed ? 'You can draft petitions.' : petitionGate.message || petitionGate.reason,
      voteStatus: voteGate.allowed ? 'You can vote on petitions.' : voteGate.message || voteGate.reason,
      petitionGateReason: petitionGate.message || '',
      voteGateReason: voteGate.message || '',
      roleLabel: citizen?.role || 'guest',
      petitionsList: renderPetitionList(state.petitions, state.votes),
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
  };

  state.petitions.unshift(petition);
  await persistPetitions(state);

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
  const choice = sanitizeText(body.choice || '', 16) || 'abstain';

  const exists = state.petitions.find((p) => p.id === petitionId);
  if (!exists) {
    return sendJson(res, 404, { error: 'petition_not_found' });
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

  if (wantsPartial) {
    const html = await renderPetitions({ req, res, state, wantsPartial: true });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/petitions');
}
