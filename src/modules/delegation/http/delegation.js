import { canReadProposal, proposalHref } from '../../petitions/proposalLinks.js';
import { canPostToGroupLane, resolveGroupScope } from '../../groups/groupScope.js';
import { filterVisibleEntries } from '../../federation/replication.js';
import { getPerson } from '../../identity/person.js';
import { evaluateAction } from '../../circle/policy.js';
import {
  buildDelegationChain,
  chooseDelegation,
  clearDelegation,
  describeDelegationFreshness,
  getDelegationDecayDays,
  listDelegationsForPerson,
  renewDelegation,
  setDelegation,
} from '../../delegation/delegation.js';
import {
  getDelegateVoteWindowDays,
  listBallotsAwaitingDelegate,
  listDelegatedBallotsForOwner,
} from '../../delegation/delegatedBallots.js';
import { recommendDelegationForPerson } from '../../groups/groups.js';
import { getTopicConfig } from '../../topics/topicGardenerClient.js';
import { listPeopleDirectory } from '../../delegation/delegateProfiles.js';
import { findSessionByHandle, findSessionByHash } from '../../identity/sessions.js';
import { renderActorLabel, resolveHandleForHash } from '../../../interfaces/http/views/actorLabel.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey } from '../../topics/preferences.js';
import { isModuleEnabled } from '../../circle/modules.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../../../interfaces/http/views/moduleGate.js';
import { buildTopicOptions, renderTopicDatalist } from '../../../interfaces/http/views/topicHelpers.js';
import { renderIssuerPill, renderPreviewPill } from '../../../interfaces/http/views/shared.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

export async function resolveConflict({ req, res, state }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'delegation', state });
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

export async function renderDelegation({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'delegation' });
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

  const votingEnabled = isModuleEnabled(state, 'votes');
  const ballotState = { ...state, votes: filterVisibleEntries(state.votes, state) };
  const html = await renderPage(
    'delegation',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      delegationStatus: permission.allowed ? 'Delegation preferences enabled.' : permission.message || 'Delegation blocked.',
      delegationReason: permission.allowed ? '' : permission.reason,
      delegationSuggestions,
      effectiveDelegations: renderEffectiveDelegations({ person, state, delegations }),
      delegationList: renderDelegationList(delegations, { decayDays: getDelegationDecayDays(state), state }),
      delegationDecayNote: renderDecayNote(getDelegationDecayDays(state)),
      delegateWindowNote: renderDelegateWindowNote(getDelegateVoteWindowDays(state)),
      delegateBallotInbox: renderDelegateBallotInbox({ person, state: ballotState, votingEnabled }),
      myDelegatedBallots: renderMyDelegatedBallots({ person, state: ballotState, votingEnabled }),
      peopleDatalist: renderPeopleDatalist(state, person),
      // A People profile links here with ?delegate=<handle>; it only pre-fills the
      // form, and the POST resolves and gates the target as usual.
      delegatePrefill: escapeHtml(sanitizeText(url?.searchParams?.get('delegate') || '', 80).replace(/^@+/, '')),
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
    return sendModuleDisabledJson({ res, moduleKey: 'delegation', state });
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
  if (intent === 'renew') {
    await renewDelegation({ person, topic, state });
    if (wantsPartial) {
      return renderDelegation({ req, res, state, wantsPartial });
    }
    return sendRedirect(res, '/delegation');
  }
  const rawTarget = sanitizeText(body.delegateHash || '', 80);
  if (!rawTarget) {
    return sendJson(res, 400, { error: 'missing_delegate', message: 'Pick a person to delegate to.' });
  }
  const resolved = resolveDelegateTarget(state, rawTarget);
  if (!resolved) {
    return sendJson(res, 404, {
      error: 'unknown_delegate',
      message: 'No verified person matches that handle or hash. Browse People to find a delegate.',
    });
  }
  await setDelegation({ person, topic, delegateHash: resolved, provider: 'manual', state });
  if (wantsPartial) {
    return renderDelegation({ req, res, state, wantsPartial });
  }
  return sendRedirect(res, '/delegation');
}


function renderDelegateWindowNote(windowDays = 0) {
  if (!windowDays) {
    return 'No delegate deadline is set in this deployment — a delegated ballot waits until you vote or the member overrides it.';
  }
  return `Members who delegate to you expect a vote within ${windowDays} day${windowDays === 1 ? '' : 's'}. After that the ballot lapses to an abstention.`;
}

// The delegate's side of the contract: which ballots are riding on them, on what, and how
// long they have. Without this a delegate has no way to discover a ballot they were handed.
function renderDelegateBallotInbox({ person, state, votingEnabled }) {
  if (!votingEnabled) return '<p class="muted">Voting is disabled.</p>';
  if (!person?.pidHash) {
    return '<p class="muted">Login to see ballots delegated to you.</p>';
  }
  const rows = listBallotsAwaitingDelegate(state, person.pidHash, { includeLapsed: true })
    .filter(({ petition }) => canReadProposal(state, person, petition));
  if (!rows.length) {
    return '<p class="muted">No ballots are waiting on your vote.</p>';
  }
  const items = rows
    .map(({ petition, resolution, ownerHash }) => {
      const urgency = describeBallotUrgency(resolution);
      const ownerLabel = renderActorLabel(state, ownerHash, { showHash: false });
      const forwarded =
        resolution.delegateHash !== person.pidHash
          ? `<p class="muted tiny">Forwarded through ${renderActorLabel(state, resolution.delegateHash, { showHash: false })}.</p>`
          : '';
      return `
        <div class="list-row">
          <div>
            <p class="small"><a href="${escapeHtml(proposalHref(petition, { view: 'ballot' }))}" data-partial>${escapeHtml(petition.title || 'Proposal')}</a></p>
            <p class="muted tiny">Delegated by ${ownerLabel} · Topic ${escapeHtml(resolution.topic || petition.topic || 'general')}</p>
            ${forwarded}
          </div>
          <div>
            ${urgency}
            ${canActOnBallot(state, person, petition)
              ? `<a class="ghost" href="${escapeHtml(proposalHref(petition, { view: 'ballot' }))}" data-partial>Vote</a>`
              : ''}
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}

// The member's side: what a delegate is currently holding for them, and whether it still has
// time to land. Overriding is a link to the proposal, where the vote form already lives.
function renderMyDelegatedBallots({ person, state, votingEnabled }) {
  if (!votingEnabled) return '<p class="muted">Voting is disabled.</p>';
  if (!person?.pidHash) {
    return '<p class="muted">Login to see ballots you delegated.</p>';
  }
  const rows = listDelegatedBallotsForOwner(state, person.pidHash)
    .filter(({ petition }) => canReadProposal(state, person, petition));
  if (!rows.length) {
    return '<p class="muted">You have no delegated ballots. Choose "hand to my delegate" when voting on a proposal.</p>';
  }
  const items = rows
    .map(({ petition, resolution, open }) => {
      const delegateLabel = renderActorLabel(state, resolution.delegateHash, { showHash: false });
      const statusPill = describeBallotStatus(resolution);
      const outcome =
        resolution.status === 'resolved'
          ? `<p class="muted tiny">Counted as <strong>${escapeHtml(resolution.choice)}</strong>.</p>`
          : '';
      const override = open && canActOnBallot(state, person, petition)
        ? `<a class="ghost" href="${escapeHtml(proposalHref(petition, { view: 'ballot' }))}" data-partial>Override</a>`
        : open ? '' : '<span class="muted tiny">Closed</span>';
      return `
        <div class="list-row">
          <div>
            <p class="small"><a href="${escapeHtml(proposalHref(petition, { view: 'ballot' }))}" data-partial>${escapeHtml(petition.title || 'Proposal')}</a></p>
            <p class="muted tiny">Held by ${delegateLabel} · Topic ${escapeHtml(resolution.topic || petition.topic || 'general')}</p>
            ${outcome}
          </div>
          <div>
            ${statusPill}
            ${override}
          </div>
        </div>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}

function canActOnBallot(state, person, petition) {
  const scope = resolveGroupScope(state, person, petition.groupId, { lane: 'petitions' });
  return scope.ok && canPostToGroupLane(state, person, scope.group, 'petitions') &&
    evaluateAction(state, person, 'vote').allowed;
}

function describeBallotUrgency(resolution) {
  if (resolution.status === 'lapsed') {
    return '<span class="pill warning">Lapsed</span>';
  }
  if (resolution.daysLeft === null) {
    return '<span class="pill ghost">No deadline</span>';
  }
  const days = resolution.daysLeft;
  const klass = days <= 1 ? 'pill warning' : 'pill';
  return `<span class="${klass}">${days} day${days === 1 ? '' : 's'} left</span>`;
}

function describeBallotStatus(resolution) {
  if (resolution.status === 'resolved') return '<span class="pill">Counted</span>';
  if (resolution.status === 'lapsed') return '<span class="pill warning">Lapsed to abstain</span>';
  if (resolution.status === 'unresolved') return '<span class="pill warning">Chain broken</span>';
  if (resolution.daysLeft === null) return '<span class="pill ghost">Awaiting delegate</span>';
  const days = resolution.daysLeft;
  const klass = days <= 1 ? 'pill warning' : 'pill ghost';
  return `<span class="${klass}">Awaiting · ${days}d left</span>`;
}

function renderEffectiveDelegations({ person, state, delegations = [] } = {}) {
  if (!person?.pidHash) {
    return '<p class="muted">Login to see how your delegations resolve.</p>';
  }
  const topics = dedupeTopics(delegations.map((entry) => entry.topic));
  if (!topics.length) {
    return '<p class="muted">No delegations set yet — set one below to see its effective chain.</p>';
  }
  const cards = [];
  for (const topicLabel of topics) {
    const chain = buildDelegationChain(state, person.pidHash, topicLabel);
    if (!chain) continue;
    cards.push(renderChainCard({ state, topicLabel, chain }));
  }
  if (!cards.length) {
    return '<p class="muted">No effective delegations resolved.</p>';
  }
  return `<div class="list-stack">${cards.join('\n')}</div>`;
}

function renderChainCard({ state, topicLabel, chain }) {
  const steps = chain.path
    .map((hash, index) => {
      if (index === 0) return '<span class="pill ghost">You</span>';
      const label = renderActorLabel(state, hash, { showHash: false });
      const link = hash
        ? `<a href="/delegates/${escapeHtml(hash)}" data-partial>${label}</a>`
        : label;
      return `<span class="pill ghost">${link}</span>`;
    })
    .join('<span class="muted tiny"> → </span>');
  const flags = [];
  if (chain.transitive) flags.push('<span class="pill">Liquid chain</span>');
  if (chain.via === 'group') flags.push('<span class="pill ghost">via group</span>');
  if (chain.cycle) flags.push('<span class="pill warning">Cycle stopped</span>');
  if (chain.blockedBanned) flags.push('<span class="pill warning">Banned delegate skipped</span>');
  if (chain.truncated) flags.push('<span class="pill warning">Chain truncated</span>');
  const hopCount = chain.hops?.length || 0;
  const explain = chain.transitive
    ? `Your vote flows through ${hopCount} forwarding ${hopCount === 1 ? 'step' : 'steps'} to the terminal delegate.`
    : 'Your vote goes directly to this delegate.';
  return `
    <article class="discussion">
      <div class="discussion__meta">
        <span class="pill ghost">Topic: ${escapeHtml(topicLabel)}</span>
        ${flags.join(' ')}
      </div>
      <p class="small">${steps}</p>
      <p class="muted tiny">${escapeHtml(explain)}</p>
    </article>
  `;
}

// Resolve a typed delegate reference (handle or hash) to a known verified person's hash.
function resolveDelegateTarget(state, input) {
  const value = String(input || '').trim().replace(/^@+/, '');
  if (!value) return null;
  const byHandle = findSessionByHandle(state, value);
  if (byHandle?.pidHash) return byHandle.pidHash;
  const byHash = findSessionByHash(state, value);
  if (byHash?.pidHash) return byHash.pidHash;
  return null;
}

// Datalist of verified people so the delegate field autocompletes handles instead of
// forcing the user to know a raw hash. Self is excluded.
function renderPeopleDatalist(state, person) {
  const people = listPeopleDirectory(state).filter((entry) => entry.hash !== person?.pidHash);
  const options = people
    .map((entry) => {
      const value = entry.handle || entry.hash;
      const handleLabel = resolveHandleForHash(state, entry.hash);
      const roleLabel = entry.isDelegate ? `${entry.role} · delegate` : entry.role;
      return `<option value="${escapeHtml(value)}">@${escapeHtml(handleLabel)} · ${escapeHtml(roleLabel)}</option>`;
    })
    .join('\n');
  return options;
}

function renderDecayNote(decayDays = 0) {
  if (!decayDays) {
    return '<p class="muted tiny">Delegation decay is off — preferences stay active until cleared.</p>';
  }
  return `<p class="muted tiny">Delegations lapse after ${decayDays} day${decayDays === 1 ? '' : 's'} without renewal. Renew to keep them active.</p>`;
}

function renderFreshnessPill(freshness) {
  if (!freshness || !freshness.decayDays) return '';
  if (freshness.status === 'expired') {
    return '<span class="pill warning">Lapsed</span>';
  }
  if (freshness.status === 'expiring') {
    const days = Math.max(0, Math.ceil(freshness.expiresInDays));
    return `<span class="pill warning">Expires in ${days}d</span>`;
  }
  return '<span class="pill ghost">Active</span>';
}

function renderDelegationList(delegations = [], { decayDays = 0, state } = {}) {
  if (!delegations.length) {
    return '<p class="muted">No delegation preferences yet.</p>';
  }
  const now = Date.now();
  const items = delegations
    .map((entry) => {
      const createdAt = formatTimestamp(entry.renewedAt || entry.createdAt);
      const delegateHashAttr = escapeHtml(entry.delegateHash || '');
      const delegateLabel = entry.delegateHash
        ? renderActorLabel(state, entry.delegateHash, { showHash: true })
        : 'unknown';
      const topicValue = escapeHtml(entry.topic || 'general');
      const profileLink = entry.delegateHash
        ? `<a class="muted tiny" href="/delegates/${delegateHashAttr}" data-partial>Profile</a>`
        : '';
      const previewPill = renderPreviewPill(entry);
      const issuerPill = renderIssuerPill(entry);
      const freshness = describeDelegationFreshness(entry, decayDays, now);
      const freshnessPill = renderFreshnessPill(freshness);
      const renewForm = decayDays
        ? `
          <form class="form-inline" method="post" action="/delegation" data-enhance="delegation-renew">
            <input type="hidden" name="intent" value="renew" />
            <input type="hidden" name="topic" value="${topicValue}" />
            <button type="submit" class="ghost">Renew</button>
          </form>`
        : '';
      return `
        <div class="list-row">
          <div>
            <p class="small">${topicValue}</p>
            <p class="muted tiny">delegate ${delegateLabel}${profileLink ? ` · ${profileLink}` : ''}</p>
          </div>
          <div>
            <span class="pill ghost">${escapeHtml(entry.provider || 'manual')}</span>
            ${freshnessPill}
            ${previewPill}
            ${issuerPill}
            ${createdAt ? `<span class="muted tiny">${createdAt}</span>` : ''}
            ${renewForm}
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
    cards.push(renderSuggestionCard({ state, topicLabel, topicKey, rec, manual }));
  }

  if (!cards.length) {
    return '<p class="muted">No group recommendations yet.</p>';
  }
  return `<div class="list-stack">${cards.join('\n')}</div>`;
}

function renderSuggestionCard({ state, topicLabel, topicKey, rec, manual }) {
  const conflictPill = rec.conflict ? '<span class="pill warning">Conflict</span>' : '<span class="pill ghost">Suggested</span>';
  const manualNote = manual
    ? `<p class="muted small">Manual override set: ${renderActorLabel(state, manual.delegateHash, { showHash: false })}.</p>`
    : '';
  const conflictNote = rec.conflict
    ? `<p class="muted small">Conflict rule: ${escapeHtml(rec.conflictRule || 'highest_priority')}. Choose a delegate.</p>`
    : '';
  const rows = rec.suggestions
    .map((suggestion) => renderSuggestionRow({ state, suggestion, topicKey, chosen: rec.chosen }))
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

function renderSuggestionRow({ state, suggestion, topicKey, chosen }) {
  const isChosen = chosen && chosen.delegateHash === suggestion.delegateHash;
  const meta = formatSuggestionMeta(suggestion);
  const chosenPill = isChosen ? '<span class="pill">Chosen</span>' : '';
  const profileLink = suggestion.delegateHash
    ? `<a class="ghost" href="/delegates/${escapeHtml(suggestion.delegateHash)}" data-partial>Profile</a>`
    : '';
  return `
    <div class="list-row">
      <div>
        <p class="small">${renderActorLabel(state, suggestion.delegateHash, { showHash: true })}</p>
        <p class="muted tiny">${escapeHtml(meta)}</p>
      </div>
      <div>
        ${chosenPill}
        ${profileLink}
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
