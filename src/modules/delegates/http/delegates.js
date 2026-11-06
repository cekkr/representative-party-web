import { isModuleEnabled } from '../../circle/modules.js';
import { evaluateAction } from '../../circle/policy.js';
import { getPerson } from '../../identity/person.js';
import { buildDelegateProfile, listPeopleDirectory } from '../../delegation/delegateProfiles.js';
import { canReadProposal, proposalHref } from '../../petitions/proposalLinks.js';
import { groupHref } from '../../groups/http/groupView.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderContextPanel } from '../../../interfaces/http/views/contextPanel.js';
import { renderProposalStage } from '../../../interfaces/http/views/petitionView.js';
import { getActorLabels, renderActorAvatar, renderActorLabel, resolveHandleForHash, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderModuleDisabled } from '../../../interfaces/http/views/moduleGate.js';

// Profile sections are GET views, like the group and proposal workspaces. The
// composer keys are historical (see UI_ROADMAP.md section inventory) and stay as-is.
const PROFILE_VIEWS = [
  ['overview', 'Overview'],
  ['delegations', 'Delegations'],
  ['votes', 'Votes'],
  ['activity', 'Activity'],
  ['endorsements', 'Endorsements'],
];

export function delegateProfileHref(hash, view = 'overview') {
  const base = `/delegates/${encodeURIComponent(hash)}`;
  return view === 'overview' ? base : `${base}?view=${view}`;
}

export async function renderDelegateDirectory({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const query = sanitizeText(url?.searchParams?.get('q') || '', 64);
  const people = listPeopleDirectory(state, { query });
  const actorLabels = getActorLabels(state);
  const countLabel = `${people.length} ${people.length === 1 ? actorLabels.actorLabel : actorLabels.actorLabelPlural}`;

  const html = await renderPage(
    'delegate-directory',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      directoryQuery: escapeHtml(query),
      directoryActorPlural: escapeHtml(actorLabels.actorLabelPlural),
      directoryCount: escapeHtml(query ? `${countLabel} match “${query}”` : `${countLabel} in this Circle`),
      directoryClear: query ? '<a class="ghost" href="/delegates" data-partial>Clear search</a>' : '',
      directoryList: renderDirectoryList(state, people, actorLabels, { query }),
    },
    { wantsPartial, title: 'People', state },
  );
  return sendHtml(res, html);
}

function renderDirectoryList(state, people = [], actorLabels = {}, { query = '' } = {}) {
  if (!people.length) {
    // Zero matches and an empty directory recover differently.
    return query
      ? `<p>No one matches “${escapeHtml(query)}”. Search by handle or role, or <a href="/delegates" data-partial>browse everyone</a>.</p>`
      : `<div class="onboarding-card"><h3>No ${escapeHtml(actorLabels.actorLabelPlural || 'members')} yet</h3><p>Verified members appear here once they sign in with their wallet.</p></div>`;
  }
  const actorLabel = actorLabels.actorLabel || 'user';
  const cards = people
    .map((entry) => {
      const handle = resolveHandleForHash(state, entry.hash);
      const received = entry.incomingTotal
        ? `${entry.incomingTotal} delegation${entry.incomingTotal === 1 ? '' : 's'} from ${entry.incomingUniqueOwners} ${entry.incomingUniqueOwners === 1 ? actorLabel : (actorLabels.actorLabelPlural || 'users')}`
        : 'No delegations received yet';
      return `
        <li>
          <article class="discussion record-card person-card">
            <header class="person-row__id">
              ${renderActorAvatar(state, entry.hash, { size: 'md' })}
              <div>
                <h3><a href="${escapeHtml(delegateProfileHref(entry.hash))}" data-partial>@${escapeHtml(handle)}</a></h3>
                <p class="topic-meta">
                  <span class="pill ghost">${escapeHtml(entry.role)}</span>
                  ${entry.isDelegate && entry.role !== 'delegate' ? '<span class="pill stage--discussion">Receives delegations</span>' : ''}
                  ${entry.banned ? '<span class="pill stance stance--concern">Banned</span>' : ''}
                </p>
              </div>
            </header>
            <footer class="muted small">${escapeHtml(received)}</footer>
          </article>
        </li>
      `;
    })
    .join('\n');
  return `<ul class="collection-grid person-grid">${cards}</ul>`;
}

export async function renderDelegateProfile({ req, res, state, wantsPartial, params, url }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const delegateHash = sanitizeText(params?.hash || '', 120);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate', message: 'Delegate hash required.' });
  }
  const requestedView = url?.searchParams?.get('view') || 'overview';
  const view = PROFILE_VIEWS.some(([key]) => key === requestedView) ? requestedView : 'overview';
  // Group-lane proposals stay inside their lane: a public profile only lists and
  // counts the proposals this viewer could open.
  const profile = buildDelegateProfile(state, delegateHash, {
    canReadPetition: (petition) => canReadProposal(state, person, petition),
  });
  const hash = profile.hash || delegateHash;
  const handle = resolveHandleForHash(state, hash);
  const isSelf = person?.pidHash === hash;

  const sections = {
    overview: () => renderOverview(profile),
    delegations: () => renderDelegationsView(profile),
    votes: () => renderVotesView(profile.votes),
    activity: () => renderActivityView(state, profile.activity),
    endorsements: () => renderEndorsementsView(state, profile.endorsements),
  };

  const html = await renderPage(
    'delegate-profile',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      profileAvatar: renderActorAvatar(state, hash, { size: 'lg' }),
      profileName: renderActorLabel(state, hash, { showHash: true }),
      profileStatus: renderProfileStatus(profile),
      profileBio: profile.bio
        ? `<p class="workspace-heading__summary">${escapeHtml(profile.bio)}</p>`
        : `<p class="workspace-heading__summary">${isSelf ? 'Add a public bio in your profile so members know what you work on.' : 'No public bio yet.'}</p>`,
      profileAction: renderProfileAction(state, person, { hash, handle, isSelf }),
      profileSections: PROFILE_VIEWS.map(([key, label]) =>
        `<a href="${escapeHtml(delegateProfileHref(hash, key))}" data-partial${view === key ? ' aria-current="page"' : ''}>${label}</a>`,
      ).join(''),
      profileContent: sections[view](),
      profileDetails: renderProfileDetails(profile),
    },
    { wantsPartial, title: `@${handle}`, state },
  );

  return sendHtml(res, html);
}

function renderProfileStatus(profile) {
  const pills = [`<span class="pill ghost">${escapeHtml(profile.role || 'unknown')}</span>`];
  if (profile.incoming?.total && profile.role !== 'delegate') {
    pills.push('<span class="pill stage--discussion">Receives delegations</span>');
  }
  pills.push(profile.banned
    ? '<span class="pill stance stance--concern">Banned</span>'
    : '<span class="pill stance stance--support">Active</span>');
  return pills.join(' ');
}

// One primary action: delegate to this person, or edit your own profile. The
// delegation form re-checks every gate on POST; this only pre-fills it.
function renderProfileAction(state, person, { handle, isSelf }) {
  if (isSelf) {
    return '<p class="workspace-heading__actions"><a class="ghost" href="/profile" data-partial>Edit your profile</a></p>';
  }
  if (!person || !evaluateAction(state, person, 'delegate').allowed) return '';
  const href = `/delegation?delegate=${encodeURIComponent(handle)}#delegation-set`;
  return `<p class="workspace-heading__actions"><a class="cta" href="${escapeHtml(href)}" data-partial>Delegate to @${escapeHtml(handle)}</a></p>`;
}

function stat(term, value, note = '') {
  return `<div class="record-stats__item"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(String(value))}</dd>${note ? `<dd class="muted tiny">${escapeHtml(note)}</dd>` : ''}</div>`;
}

function renderOverview(profile) {
  const incoming = profile.incoming || { total: 0, uniqueOwners: 0 };
  const outgoing = profile.outgoing || { total: 0 };
  const votes = profile.votes || { total: 0 };
  const activity = profile.activity || {};
  return `
    <section class="panel stack" data-composer-section="delegate-profile-summary" data-section-label="Delegate summary">
      <h2>Accountability</h2>
      <dl class="record-stats">
        ${stat('Delegations received', incoming.total, `from ${incoming.uniqueOwners} ${incoming.uniqueOwners === 1 ? 'member' : 'members'}`)}
        ${stat('Delegations set', outgoing.total)}
        ${stat('Votes cast', votes.total)}
        ${stat('Proposals drafted', activity.petitions || 0)}
        ${stat('Discussion posts', activity.discussions || 0)}
        ${stat('Social posts', activity.socialPosts || 0)}
      </dl>
      ${renderReputation(profile.deliberationScore)}
    </section>`;
}

function renderReputation(deliberationScore = {}) {
  const score = Number.isFinite(deliberationScore?.score) ? deliberationScore.score : 0;
  const components = deliberationScore?.components || {};
  const multiplier = Number.isFinite(deliberationScore?.recencyMultiplier) ? deliberationScore.recencyMultiplier : 1;
  const breakdown = [
    `trust ${components.trust || 0}`,
    `participation ${components.participation || 0}`,
    `deliberation ${components.deliberation || 0}`,
    `endorsement ${components.endorsement || 0}`,
  ];
  return `
    <details class="note">
      <summary>Deliberation score: <strong>${score}</strong> / 100${deliberationScore?.risingStar ? ' · Rising star' : ''}</summary>
      <p class="muted small">${escapeHtml(breakdown.join(' · '))}</p>
      ${multiplier < 1 ? `<p class="muted tiny">Recency factor ${multiplier.toFixed(2)} applied for inactivity.</p>` : ''}
      <p class="muted tiny">Advisory only. It never casts or redirects a vote, and every delegation stays overridable per topic.</p>
    </details>`;
}

function renderTopicList(delegation = {}, empty) {
  const topics = delegation.topics || [];
  if (!topics.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  const rows = topics
    .slice(0, 12)
    .map((entry) => `<li class="list-row"><span>${escapeHtml(entry.topic)}</span><span class="pill ghost">${entry.count}</span></li>`)
    .join('');
  return `<ul class="plain topic-count-list">${rows}</ul>`;
}

function renderDelegationsView(profile) {
  const incoming = profile.incoming || {};
  const outgoing = profile.outgoing || {};
  return `
    <section class="panel stack" data-composer-section="delegate-profile-endorsements" data-section-label="Delegation coverage">
      <h2>Delegation coverage</h2>
      <h3>Delegations received</h3>
      <p class="muted small">${incoming.total || 0} across ${incoming.uniqueOwners || 0} members, by topic.</p>
      ${renderTopicList(incoming, 'No one delegates to this member yet.')}
      <h3>Delegations set</h3>
      ${renderTopicList(outgoing, 'This member votes directly on every topic.')}
    </section>`;
}

function renderVotesView(votes = {}) {
  const body = votes.total
    ? `<dl class="record-stats">
        ${stat('Yes', votes.yes || 0)}
        ${stat('No', votes.no || 0)}
        ${stat('Abstain', votes.abstain || 0)}
        ${stat('Through delegation', votes.auto || 0)}
      </dl>`
    : '<p class="muted">No votes recorded yet.</p>';
  return `
    <section class="panel stack" data-composer-section="delegate-profile-delegations" data-section-label="Vote history">
      <h2>Vote history</h2>
      <p class="muted small">${votes.total || 0} ballots cast.</p>
      ${body}
    </section>`;
}

function renderActivityView(state, activity = {}) {
  const recent = (activity.recentPetitions || [])
    .map((entry) => (state.petitions || []).find((petition) => petition.id === entry.id))
    .filter(Boolean);
  const list = recent.length
    ? `<ul class="discussion-list">${recent.map((proposal) => {
      const updated = formatTimestamp(proposal.updatedAt || proposal.createdAt);
      return `
        <li>
          <article class="discussion">
            <div class="topic-meta">${renderProposalStage(proposal)}</div>
            <h3><a href="${escapeHtml(proposalHref(proposal))}" data-partial>${escapeHtml(proposal.title || 'Proposal')}</a></h3>
            ${updated ? `<p class="muted small">Updated ${escapeHtml(updated)}</p>` : ''}
          </article>
        </li>`;
    }).join('')}</ul>`
    : '<p class="muted">No proposals drafted yet.</p>';
  return `
    <section class="panel stack" data-composer-section="delegate-profile-votes" data-section-label="Recent activity">
      <h2>Recent proposals</h2>
      ${list}
    </section>`;
}

function renderEndorsementsView(state, endorsements = {}) {
  const groups = (state.groups || []);
  const groupLink = (id, fallback) => {
    const group = groups.find((entry) => entry.id === id);
    return group
      ? `<a href="${escapeHtml(groupHref(group.id))}" data-partial>${escapeHtml(group.name || fallback)}</a>`
      : escapeHtml(fallback || 'A group');
  };
  const cachets = endorsements.groups || [];
  const wins = endorsements.elections || [];
  const cachetList = cachets.length
    ? `<ul class="plain">${cachets.slice(0, 10).map((entry) =>
      `<li class="list-row"><span>${groupLink(entry.groupId, entry.groupName)} recommends for <strong>${escapeHtml(entry.topic)}</strong></span><span class="muted tiny">Priority ${escapeHtml(String(entry.priority))}</span></li>`,
    ).join('')}</ul>`
    : '<p class="muted">No group recommends this member yet.</p>';
  const winList = wins.length
    ? `<ul class="plain">${wins.slice(0, 10).map((entry) => {
      const closed = formatTimestamp(entry.closedAt);
      const method = [entry.method, Number.isFinite(entry.rounds) ? `${entry.rounds} rounds` : ''].filter(Boolean).join(', ');
      return `<li class="list-row"><span>${groupLink(entry.groupId, 'A group')} elected for <strong>${escapeHtml(entry.topic)}</strong>${method ? ` <span class="muted small">(${escapeHtml(method)})</span>` : ''}</span>${closed ? `<span class="muted tiny">${escapeHtml(closed)}</span>` : ''}</li>`;
    }).join('')}</ul>`
    : '<p class="muted">No group elections won yet.</p>';
  return `
    <section class="panel stack" data-composer-section="delegate-profile-history" data-section-label="Group endorsements">
      <h2>Endorsements</h2>
      <p class="muted small">Group recommendations and election results are advisory. Members can delegate to anyone and override at any time.</p>
      <h3>Group recommendations</h3>
      ${cachetList}
      <h3>Election wins</h3>
      ${winList}
    </section>`;
}

function renderProfileDetails(profile) {
  const activity = profile.activity || {};
  return renderContextPanel({
    facts: [
      { term: 'Role', value: profile.role || 'unknown' },
      { term: 'Status', value: profile.banned ? 'Banned' : 'Active' },
      { term: 'Last active', value: formatTimestamp(activity.lastActiveAt) || 'No activity yet' },
      { term: 'Group recommendations', value: String(profile.endorsements?.groups?.length || 0) },
      { term: 'Election wins', value: String(profile.endorsements?.elections?.length || 0) },
    ],
    guidance: ['Delegation is topic-scoped and revocable. Voting yourself always replaces a delegated ballot.'],
  });
}
