import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction } from '../../../modules/circle/policy.js';
import { chooseDelegation, clearDelegation, listDelegationsForPerson, setDelegation } from '../../../modules/delegation/delegation.js';
import { recommendDelegationForPerson } from '../../../modules/groups/groups.js';
import { getTopicConfig } from '../../../modules/topics/topicGardenerClient.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey } from '../../../modules/topics/preferences.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';
import { buildTopicOptions, renderTopicDatalist } from '../views/topicHelpers.js';
import { renderIssuerPill } from '../views/shared.js';
import { resolvePersonHandle } from '../views/actorLabel.js';

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
  const suggestionTopics = topicOptions.length ? topicOptions : ['general'];
  const delegationSuggestions = renderDelegationSuggestions({
    person,
    state,
    topics: suggestionTopics,
    delegations,
  });

  const html = await renderPage(
    'delegation',
    {
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      delegationStatus: permission.allowed ? 'Delegation preferences enabled.' : permission.message || 'Delegation blocked.',
      delegationReason: permission.allowed ? '' : permission.reason,
      delegationSuggestions,
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


function renderDelegationList(delegations = []) {
  if (!delegations.length) {
    return '<p class="muted">No delegation preferences yet.</p>';
  }
  const items = delegations
    .map((entry) => {
      const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      const previewPill = entry.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : '';
      const issuerPill = renderIssuerPill(entry);
      return `
        <div class="list-row">
          <div>
            <p class="small">${escapeHtml(entry.topic || 'general')}</p>
            <p class="muted tiny">delegate ${escapeHtml(entry.delegateHash)}</p>
          </div>
          <div>
            <span class="pill ghost">${escapeHtml(entry.provider || 'manual')}</span>
            ${previewPill}
            ${issuerPill}
            ${createdAt ? `<span class="muted tiny">${createdAt}</span>` : ''}
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}

function renderDelegationSuggestions({ person, state, topics = [], delegations = [] } = {}) {
  if (!person) {
    return '<p class="muted">Login to see group delegate recommendations.</p>';
  }
  const topicList = dedupeTopics(topics);
  if (!topicList.length) {
    return '<p class="muted">No topic anchors yet. Add preferences to see group suggestions.</p>';
  }

  const cards = [];
  for (const topicLabel of topicList) {
    const topicKey = normalizeTopicKey(topicLabel);
    const rec = recommendDelegationForPerson(person, topicKey, state);
    if (!rec?.suggestions?.length) continue;
    const manual = delegations.find((entry) => normalizeTopicKey(entry.topic) === topicKey);
    cards.push(renderSuggestionCard({ topicLabel, topicKey, rec, manual }));
  }

  if (!cards.length) {
    return '<p class="muted">No group recommendations yet.</p>';
  }
  return `<div class="list-stack">${cards.join('\n')}</div>`;
}

function renderSuggestionCard({ topicLabel, topicKey, rec, manual }) {
  const conflictPill = rec.conflict ? '<span class="pill warning">Conflict</span>' : '<span class="pill ghost">Suggested</span>';
  const manualNote = manual
    ? `<p class="muted small">Manual override set: ${escapeHtml(manual.delegateHash)}.</p>`
    : '';
  const conflictNote = rec.conflict
    ? `<p class="muted small">Conflict rule: ${escapeHtml(rec.conflictRule || 'highest_priority')}. Choose a delegate.</p>`
    : '';
  const rows = rec.suggestions
    .map((suggestion) => renderSuggestionRow({ suggestion, topicKey, chosen: rec.chosen }))
    .join('\n');

  return `
    <article class="discussion">
      <div class="discussion__meta">
        <span class="pill ghost">Topic: ${escapeHtml(topicLabel)}</span>
        ${conflictPill}
      </div>
      ${manualNote}
      ${conflictNote}
      <div class="list-stack">
        ${rows}
      </div>
    </article>
  `;
}

function renderSuggestionRow({ suggestion, topicKey, chosen }) {
  const isChosen = chosen && chosen.delegateHash === suggestion.delegateHash;
  const meta = formatSuggestionMeta(suggestion);
  const chosenPill = isChosen ? '<span class="pill">Chosen</span>' : '';
  return `
    <div class="list-row">
      <div>
        <p class="small">${escapeHtml(suggestion.delegateHash)}</p>
        <p class="muted tiny">${escapeHtml(meta)}</p>
      </div>
      <div>
        ${chosenPill}
        <form class="form-inline" method="post" action="/delegation/conflict" data-enhance="delegation-conflict">
          <input type="hidden" name="topic" value="${escapeHtml(topicKey)}" />
          <input type="hidden" name="delegateHash" value="${escapeHtml(suggestion.delegateHash)}" />
          <button type="submit" class="ghost">Use delegate</button>
        </form>
      </div>
    </div>
  `;
}

function formatSuggestionMeta(suggestion = {}) {
  const parts = [];
  if (suggestion.groupId) {
    parts.push(`Group ${suggestion.groupId}`);
  }
  const isElection = suggestion.provider === 'group-election' || suggestion.electionId;
  if (isElection) {
    const electionBits = ['Election winner'];
    if (suggestion.electionMethod) {
      electionBits.push(`method ${suggestion.electionMethod}`);
    }
    if (suggestion.electionClosedAt) {
      electionBits.push(`closed ${formatTimestamp(suggestion.electionClosedAt)}`);
    }
    if (suggestion.electionId) {
      electionBits.push(`id ${String(suggestion.electionId).slice(0, 8)}`);
    }
    parts.push(electionBits.join(' · '));
  } else {
    const priority = Number.isFinite(suggestion.priority) ? suggestion.priority : 0;
    parts.push(`Priority ${priority}`);
    if (suggestion.provider) {
      parts.push(`source ${suggestion.provider}`);
    }
  }
  return parts.join(' · ');
}

function formatTimestamp(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString();
}

function dedupeTopics(topics = []) {
  const seen = new Set();
  const output = [];
  for (const topic of topics || []) {
    const label = sanitizeText(String(topic || '').trim(), 48);
    if (!label) continue;
    const key = normalizeTopicKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(label);
  }
  return output.slice(0, 12);
}
