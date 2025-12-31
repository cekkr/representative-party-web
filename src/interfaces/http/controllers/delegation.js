import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction } from '../../../modules/circle/policy.js';
import { chooseDelegation, clearDelegation, listDelegationsForPerson, setDelegation } from '../../../modules/delegation/delegation.js';
import { getTopicConfig } from '../../../modules/topics/topicGardenerClient.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey } from '../../../modules/topics/preferences.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';

export async function resolveConflict({ req, res, state }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'delegate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Delegation not allowed.' });
  }
  const body = await readRequestBody(req);
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate' });
  }
  await chooseDelegation({ person, topic, delegateHash, state });
  return sendJson(res, 200, { status: 'ok', topic, delegateHash });
}

export async function renderDelegation({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'delegate');
  const topicConfig = getTopicConfig(state);
  const topicPreferences = getTopicPreferences(state, person);
  const delegations = listDelegationsForPerson(state, person);
  const topicOptions = buildTopicOptions({
    anchors: topicConfig.anchors,
    pinned: topicConfig.pinned,
    preferences: topicPreferences,
    entries: delegations,
  });

  const html = await renderPage(
    'delegation',
    {
      personHandle: person?.handle || 'Guest',
      roleLabel: person?.role || 'guest',
      delegationStatus: permission.allowed ? 'Delegation preferences enabled.' : permission.message || 'Delegation blocked.',
      delegationReason: permission.allowed ? '' : permission.reason,
      delegationList: renderDelegationList(delegations),
      topicDatalist: renderTopicDatalist(topicOptions),
      topicPreferencesValue: formatTopicList(topicPreferences) || 'none',
      topicAnchors: formatTopicList(topicConfig.anchors || []),
      topicPinned: formatTopicList(topicConfig.pinned || []) || 'none',
    },
    { wantsPartial, title: 'Delegation Preferences', state },
  );
  return sendHtml(res, html);
}

export async function updateDelegation({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'delegate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Delegation not allowed.' });
  }
  const body = await readRequestBody(req);
  const intent = body.intent || 'set';
  const topic = sanitizeText(body.topic || 'general', 64);
  if (intent === 'clear') {
    await clearDelegation({ person, topic, state });
    if (wantsPartial) {
      return renderDelegation({ req, res, state, wantsPartial });
    }
    return sendRedirect(res, '/delegation');
  }
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate', message: 'Delegate hash required.' });
  }
  await setDelegation({ person, topic, delegateHash, provider: 'manual', state });
  if (wantsPartial) {
    return renderDelegation({ req, res, state, wantsPartial });
  }
  return sendRedirect(res, '/delegation');
}

function buildTopicOptions({ anchors = [], pinned = [], preferences = [], entries = [] } = {}, { limit = 18 } = {}) {
  const topics = [];
  const seen = new Set();
  const pushTopic = (value) => {
    const label = sanitizeText(String(value || '').trim(), 48);
    if (!label) return;
    const key = normalizeTopicKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    topics.push(label);
  };

  for (const topic of preferences || []) pushTopic(topic);
  for (const topic of pinned || []) pushTopic(topic);
  for (const topic of anchors || []) pushTopic(topic);
  for (const entry of entries || []) pushTopic(entry.topic);

  return topics.slice(0, limit);
}

function renderTopicDatalist(topics = []) {
  return (topics || []).map((topic) => `<option value="${escapeHtml(topic)}"></option>`).join('\n');
}

function renderDelegationList(delegations = []) {
  if (!delegations.length) {
    return '<p class="muted">No delegation preferences yet.</p>';
  }
  const items = delegations
    .map((entry) => {
      const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      return `
        <div class="list-row">
          <div>
            <p class="small">${escapeHtml(entry.topic || 'general')}</p>
            <p class="muted tiny">delegate ${escapeHtml(entry.delegateHash)}</p>
          </div>
          <div>
            <span class="pill ghost">${escapeHtml(entry.provider || 'manual')}</span>
            ${createdAt ? `<span class="muted tiny">${createdAt}</span>` : ''}
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}
