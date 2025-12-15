import { POLICIES } from '../config.js';
import { persistPeers, persistSettings } from '../state/storage.js';
import { evaluateAction, getCirclePolicyState, getEffectivePolicy } from '../services/policy.js';
import { sendHtml } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';
import { renderPage } from '../views/templates.js';

export async function renderAdmin({ req, res, state, wantsPartial }) {
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const postingGate = evaluateAction(state, null, 'post');
  const html = await renderPage(
    'admin',
    {
      circleName: effective.circleName,
      policyId: effective.id,
      enforceCircleChecked: effective.enforceCircle ? 'checked' : '',
      requireVerificationChecked: effective.requireVerification ? 'checked' : '',
      adminContact: effective.adminContact,
      preferredPeer: effective.preferredPeer,
      policyVersion: effective.version || POLICIES.version,
      initialized: effective.initialized,
      peersKnown: policy.peersKnown,
      ledgerEntries: policy.ledgerEntries,
      notes: effective.notes,
      firstRunNote: effective.initialized ? '' : 'First installation mode: configure policy and save to persist.',
      flash: null,
      postingGate: postingGate.allowed ? 'Open posting allowed (demo).' : postingGate.message || 'Verification required before posting.',
    },
    { wantsPartial, title: 'Admin · Circle Settings' },
  );
  return sendHtml(res, html);
}

export async function updateAdmin({ req, res, state, wantsPartial }) {
  const body = await readRequestBody(req);
  const prev = state.settings || {};
  const enforceCircle = parseBoolean(body.enforceCircle, false);
  const requireVerification = parseBoolean(body.requireVerification, false);
  const newPeer = sanitizeText(body.peerJoin || '', 200);
  const preferredPeer = sanitizeText(body.preferredPeer || prev.preferredPeer || '', 200);

  state.settings = {
    ...prev,
    initialized: true,
    circleName: sanitizeText(body.circleName || prev.circleName || 'Party Circle', 80),
    policyId: sanitizeText(body.policyId || prev.policyId || POLICIES.id, 64) || POLICIES.id,
    enforceCircle,
    requireVerification,
    adminContact: sanitizeText(body.adminContact || prev.adminContact || '', 120),
    preferredPeer,
    notes: sanitizeText(body.notes || prev.notes || '', 400),
  };

  let peersAdded = 0;
  const peersToAdd = Array.from(new Set([newPeer, preferredPeer].filter(Boolean)));
  for (const peer of peersToAdd) {
    if (!state.peers.has(peer)) {
      state.peers.add(peer);
      peersAdded += 1;
    }
  }
  if (peersAdded > 0) {
    await persistPeers(state);
  }

  await persistSettings(state);

  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const postingGate = evaluateAction(state, null, 'post');
  const flashParts = ['Settings saved'];
  if (peersAdded > 0) {
    flashParts.push(`Added peer(s) "${peersToAdd.join(', ')}" to Circle registry.`);
  }
  if (enforceCircle) {
    flashParts.push('Circle enforcement enabled.');
  }
  if (requireVerification) {
    flashParts.push('Wallet verification required for posting.');
  }

  const html = await renderPage(
    'admin',
    {
      circleName: effective.circleName,
      policyId: effective.id,
      enforceCircleChecked: effective.enforceCircle ? 'checked' : '',
      requireVerificationChecked: effective.requireVerification ? 'checked' : '',
      adminContact: effective.adminContact,
      preferredPeer: effective.preferredPeer,
      policyVersion: effective.version || POLICIES.version,
      initialized: effective.initialized,
      peersKnown: policy.peersKnown,
      ledgerEntries: policy.ledgerEntries,
      notes: effective.notes,
      firstRunNote: effective.initialized ? '' : 'First installation mode: configure policy and save to persist.',
      flash: flashParts.join(' '),
      postingGate: postingGate.allowed ? 'Open posting allowed (demo).' : postingGate.message || 'Verification required before posting.',
    },
    { wantsPartial, title: 'Admin · Circle Settings' },
  );

  if (wantsPartial) {
    return sendHtml(res, html);
  }

  return sendHtml(res, html);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
}
