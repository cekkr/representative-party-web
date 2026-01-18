import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { getPerson } from '../../../modules/identity/person.js';
import { buildDelegateProfile } from '../../../modules/delegation/delegateProfiles.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderPage } from '../views/templates.js';
import { resolvePersonHandle } from '../views/actorLabel.js';
import { renderModuleDisabled } from '../views/moduleGate.js';

export async function renderDelegateProfile({ req, res, state, wantsPartial, params }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const delegateHash = sanitizeText(params?.hash || '', 120);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate', message: 'Delegate hash required.' });
  }
  const profile = buildDelegateProfile(state, delegateHash);
  const handleLabel = profile.handle || 'Unknown handle';
  const roleLabel = profile.role || 'unknown';
  const statusLabel = profile.banned ? 'banned' : 'active';
  const bio = profile.bio || 'No public bio on file. Add a "publicBio" field in profile settings to share.';

  const html = await renderPage(
    'delegate-profile',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      delegateHandle: escapeHtml(handleLabel),
      delegateHash: escapeHtml(profile.hash || delegateHash),
      delegateRole: escapeHtml(roleLabel),
      delegateStatus: escapeHtml(statusLabel),
      delegateBio: escapeHtml(bio),
      delegateStats: renderStats(profile),
      incomingDelegations: renderDelegationTopics('Delegations received', profile.incoming, { showOwners: true }),
      outgoingDelegations: renderDelegationTopics('Delegations set', profile.outgoing),
      voteSummary: renderVoteSummary(profile.votes),
      activitySummary: renderActivitySummary(profile.activity),
      groupEndorsements: renderGroupEndorsements(profile.endorsements?.groups || []),
      electionWins: renderElectionWins(profile.endorsements?.elections || []),
    },
    { wantsPartial, title: 'Delegate Profile', state },
  );

  return sendHtml(res, html);
}

function renderStats(profile) {
  const incoming = profile.incoming || { total: 0, uniqueOwners: 0 };
  const outgoing = profile.outgoing || { total: 0 };
  const votes = profile.votes || { total: 0 };
  const activity = profile.activity || { petitions: 0, discussions: 0, socialPosts: 0 };
  const lastActive = formatTimestamp(activity.lastActiveAt) || 'No activity yet';
  const rows = [
    `Delegations received: ${incoming.total} from ${incoming.uniqueOwners} unique delegators`,
    `Delegations set: ${outgoing.total}`,
    `Votes cast: ${votes.total}`,
    `Petitions drafted: ${activity.petitions}`,
    `Discussion posts: ${activity.discussions}`,
    `Social posts: ${activity.socialPosts}`,
    `Last activity: ${lastActive}`,
  ];
  return `<ul class="plain">${rows.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul>`;
}

function renderDelegationTopics(title, delegation = {}, { showOwners = false } = {}) {
  const topics = delegation.topics || [];
  if (!topics.length) {
    return `<p class="muted small">${escapeHtml(title)}: none.</p>`;
  }
  const totalLine = showOwners
    ? `${title} (total ${delegation.total || 0} across ${delegation.uniqueOwners || 0} people)`
    : `${title} (total ${delegation.total || 0})`;
  const items = topics
    .slice(0, 8)
    .map((entry) => `<li>${escapeHtml(entry.topic)} - ${entry.count}</li>`)
    .join('');
  return `
    <div class="stack">
      <p class="muted small">${escapeHtml(totalLine)}</p>
      <ul class="plain">${items}</ul>
    </div>
  `;
}

function renderVoteSummary(votes = {}) {
  if (!votes.total) {
    return '<p class="muted small">No vote history yet.</p>';
  }
  const parts = [
    `yes ${votes.yes || 0}`,
    `no ${votes.no || 0}`,
    `abstain ${votes.abstain || 0}`,
    `auto ${votes.auto || 0}`,
  ];
  return `<p class="muted small">Vote breakdown - ${escapeHtml(parts.join(' - '))}</p>`;
}

function renderActivitySummary(activity = {}) {
  const recent = activity.recentPetitions || [];
  if (!recent.length) {
    return '<p class="muted small">No recent petitions drafted.</p>';
  }
  const items = recent
    .map((petition) => {
      const updated = formatTimestamp(petition.updatedAt);
      return `<li>${escapeHtml(petition.title || 'Proposal')} - ${escapeHtml(petition.status)}${updated ? ` - ${escapeHtml(updated)}` : ''}</li>`;
    })
    .join('');
  return `<ul class="plain">${items}</ul>`;
}

function renderGroupEndorsements(endorsements = []) {
  if (!endorsements.length) {
    return '<p class="muted small">No group endorsements recorded.</p>';
  }
  const items = endorsements
    .slice(0, 10)
    .map((entry) => {
      const updated = formatTimestamp(entry.updatedAt);
      const label = `${entry.groupName} - ${entry.topic} - prio ${entry.priority}`;
      const detail = entry.provider ? ` - ${entry.provider}` : '';
      return `<li>${escapeHtml(label)}${detail ? escapeHtml(detail) : ''}${updated ? ` - ${escapeHtml(updated)}` : ''}</li>`;
    })
    .join('');
  return `<ul class="plain">${items}</ul>`;
}

function renderElectionWins(wins = []) {
  if (!wins.length) {
    return '<p class="muted small">No group election wins yet.</p>';
  }
  const items = wins
    .slice(0, 10)
    .map((entry) => {
      const closedAt = formatTimestamp(entry.closedAt);
      const method = entry.method ? ` - method ${entry.method}` : '';
      const rounds = Number.isFinite(entry.rounds) ? ` - rounds ${entry.rounds}` : '';
      const base = `Group ${entry.groupId} - ${entry.topic}${method}${rounds}`;
      return `<li>${escapeHtml(base)}${closedAt ? ` - ${escapeHtml(closedAt)}` : ''}</li>`;
    })
    .join('');
  return `<ul class="plain">${items}</ul>`;
}
