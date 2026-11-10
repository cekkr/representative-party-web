import { evaluateAction } from '../../circle/policy.js';
import { isModuleEnabled } from '../../circle/modules.js';
import { buildGroupTree, formatGroupLineage, listAncestorGroups, listChildGroups } from '../groupTree.js';
import { buildCategoryDirectory } from '../categoryDirectory.js';
import { listElections, pickWinner } from '../groupElections.js';
import { getGroupPolicy } from '../groupPolicy.js';
import { canReadGroupLane } from '../groupScope.js';
import { getGroupMemberRole, GROUP_ROLES, isGroupMember } from '../groups.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderIssuerPill, renderPreviewPill } from '../../../interfaces/http/views/shared.js';
import { renderActorLabel, resolveHandleForHash } from '../../../interfaces/http/views/actorLabel.js';

export function groupHref(groupId, view = 'overview') {
  const query = new URLSearchParams({ group: groupId });
  if (view !== 'overview') query.set('view', view);
  return `/groups?${query}`;
}

function groupLink(group, className = '') {
  return `<a ${className ? `class="${className}" ` : ''}href="${escapeHtml(groupHref(group.id))}" data-partial>${escapeHtml(group.name || 'Group')}</a>`;
}

export const GROUPS_PAGE_SIZE = 20;

// Browse rows for the directory: the branch tree when browsing, a flat list of matches
// when searching. A match keeps its lineage line, so a branch found by search still
// says where it sits.
export function listGroupDirectoryRows(groups = [], { query = '' } = {}) {
  const rows = buildGroupTree(groups);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows
    .filter(({ group }) => [group.name, group.description, ...(group.topics || [])]
      .some((value) => String(value || '').toLowerCase().includes(needle)))
    .map(({ group }) => ({ group, depth: 0 }));
}

export function renderGroupList(groups, { rows, query = '' } = {}) {
  if (!groups.length) return '<p class="muted">No groups yet. Create a group to start a workspace.</p>';
  const visible = rows || buildGroupTree(groups);
  if (!visible.length) {
    // Zero matches recover differently from an empty directory.
    return `<p class="muted">No group matches “${escapeHtml(query)}”. Search by name, description, or category, or <a href="/groups" data-partial>browse every group</a>.</p>`;
  }
  const items = visible.map(({ group, depth }) => {
    const lineage = formatGroupLineage({ groups }, group);
    return `
      <li style="--group-depth: ${Math.min(depth, 3)}">
        <article class="discussion record-card">
          ${lineage ? `<p class="muted small">Branch of ${escapeHtml(lineage)}</p>` : ''}
          <h3>${groupLink(group)}</h3>
          ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ''}
          <footer class="discussion__meta">
            <span class="muted small">${memberCount(group)}</span>
            ${renderPreviewPill(group)}
            ${group.topics?.length ? `<span class="muted small">${escapeHtml(group.topics.join(' · '))}</span>` : ''}
          </footer>
        </article>
      </li>`;
  });
  return `<ul class="discussion-list group-tree">${items.join('')}</ul>`;
}

function memberCount(group) {
  const count = group.members?.length || 0;
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

export function groupWorkspaceData(group, person, state, { view, manage, groups }) {
  const role = getGroupMemberRole(group, person?.pidHash);
  const views = [['overview', 'Overview'], ['members', 'Members'], ['decisions', 'Decisions']];
  if (manage) views.push(['settings', 'Settings']);
  const policy = getGroupPolicy(state, group.id);
  const visibleIds = new Set(groups.map(({ id }) => id));
  const ancestors = listAncestorGroups(state, group).reverse().filter(({ id }) => visibleIds.has(id));
  const lanes = [
    ['discussion', 'Group discussion'],
    ['petitions', 'Group proposals'],
  ].filter(([key]) => policy.lanes?.[key] && isModuleEnabled(state, key));
  const canReadLanes = lanes.length && canReadGroupLane(state, person, group);
  const laneLinks = canReadLanes
    ? lanes.map(([key, label]) => `<a class="ghost" href="/${key}?group=${escapeHtml(encodeURIComponent(group.id))}" data-partial>${label}</a>`).join('')
    : '';
  const canChangeMembership = person?.pidHash && evaluateAction(state, person, 'post').allowed;
  const membership = canChangeMembership ? `
    <form class="workspace-heading__actions" method="post" action="/groups" data-enhance="groups">
      <input type="hidden" name="groupId" value="${escapeHtml(group.id)}" />
      <input type="hidden" name="returnView" value="${view}" />
      <input type="hidden" name="action" value="${role ? 'leave' : 'join'}" />
      <button type="submit" class="${role ? 'ghost' : 'cta'}">${role ? 'Leave group' : 'Join group'}</button>
    </form>` : '';

  const content = {
    overview: () => renderGroupOverview(group, {
      children: listChildGroups(state, group.id).filter(({ id }) => visibleIds.has(id)),
      laneLinks,
      privateLanes: lanes.length && !canReadLanes,
    }),
    members: () => renderRolePanel(group, state, { role, manage }),
    decisions: () => renderDecisions(group, person, state, manage),
    settings: () => renderSettings(group, policy),
  };
  return {
    groupTitle: escapeHtml(group.name || 'Group'),
    groupLineage: ancestors.map((ancestor) => `<span aria-hidden="true">/</span> ${groupLink(ancestor)}`).join(' '),
    groupSummary: group.description ? `<p class="workspace-heading__summary">${escapeHtml(group.description)}</p>` : '',
    groupStatus: `<span class="pill ghost">${memberCount(group)}</span>
      <span class="pill ghost">${role ? formatRoleLabel(role) : 'Not a member'}</span>
      ${lanes.length ? `<span class="pill ghost">${policy.lanesVisibility === 'public' ? 'Public lanes' : 'Members-only lanes'}</span>` : ''}
      ${renderPreviewPill(group)}`,
    groupMembership: membership,
    groupSections: views.map(([key, label]) =>
      `<a href="${escapeHtml(groupHref(group.id, key))}" data-partial${view === key ? ' aria-current="page"' : ''}>${label}</a>`,
    ).join(''),
    groupContent: content[view](),
  };
}

function renderGroupOverview(group, { children, laneLinks, privateLanes }) {
  return `
    <section class="panel stack" data-composer-section="group-overview" data-section-label="Group overview">
      <h2>Group work</h2>
      ${laneLinks ? `<div class="workspace-heading__actions">${laneLinks}</div>` : ''}
      ${privateLanes ? '<p class="muted">Join this group to read its internal lanes.</p>' : ''}
      ${!privateLanes && !laneLinks ? '<p class="muted">This group has no active discussion or proposal lanes.</p>' : ''}
      <h3>Categories</h3>
      <p>${group.topics?.length ? escapeHtml(group.topics.join(' · ')) : 'No categories declared.'}</p>
      ${children.length ? `<div><h3>Branches</h3><ul>${children.map((child) => `<li>${groupLink(child)}</li>`).join('')}</ul></div>` : ''}
    </section>`;
}

function renderRolePanel(group, state, { role: viewerRole, manage }) {
  const members = group.members || [];
  const rows = (viewerRole || manage ? members : [])
    .map((hash) => {
      const role = getGroupMemberRole(group, hash) || 'member';
      const label = renderActorLabel(state, hash, { showHash: false });
      const control = manage
        ? `
          <form class="form-inline" method="post" action="/groups/roles" data-enhance="groups">
            <input type="hidden" name="groupId" value="${escapeHtml(group.id)}" />
            <input type="hidden" name="memberHash" value="${escapeHtml(hash)}" />
            <select name="role" aria-label="Role for @${escapeHtml(resolveHandleForHash(state, hash))}">
              ${GROUP_ROLES.map(
                (value) =>
                  `<option value="${escapeHtml(value)}" ${role === value ? 'selected' : ''}>${escapeHtml(formatRoleLabel(value))}</option>`,
              ).join('')}
            </select>
            <button type="submit" class="ghost">Set role</button>
          </form>`
        : `<span class="pill ghost">${escapeHtml(formatRoleLabel(role))}</span>`;
      return `<li class="list-row"><div><p class="small">${label}</p></div><div>${control}</div></li>`;
    })
    .join('');
  return `
    <section class="panel stack" data-composer-section="group-members" data-section-label="Group members">
      <h2>Members and roles</h2>
      ${rows ? `<ul class="list-stack group-member-list">${rows}</ul>` : `<p class="muted">${members.length ? 'Join the group to see its roster.' : 'This group has no members.'}</p>`}
      ${rows ? '<p class="muted small">Lane moderators can promote items and decide promotion requests. Group administrators manage roles and settings.</p>' : ''}
    </section>
  `;
}

function formatRoleLabel(role) {
  if (role === 'laneModerator') return 'Lane moderator';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

export function renderParentOptions(groups) {
  const rows = buildGroupTree(groups);
  const options = rows
    .map(({ group, depth }) => {
      const indent = depth ? `${'\u00a0\u00a0'.repeat(depth)}\u21b3 ` : '';
      return `<option value="${escapeHtml(group.id)}">${indent}${escapeHtml(group.name || 'Group')}</option>`;
    })
    .join('');
  return `<option value="" selected>No parent — top level</option>${options}`;
}

// "Who works on what": the categories groups have declared, and who each group currently
// puts forward for them. This is the discovery path for topic-scoped delegation.
export function renderCategoryDirectory(state, person) {
  const rows = buildCategoryDirectory(state);
  if (!rows.length) {
    return '<p class="muted">No group has declared a category yet. Add topics to a group to appear here.</p>';
  }
  const items = rows
    .map((row) => {
      const groupNames = row.groups
        .map((group) => {
          const lineage = group.lineage.length ? `${group.lineage.join(' / ')} / ` : '';
          return groupLink({ ...group, name: lineage + group.name }, 'pill ghost');
        })
        .join(' ');
      const delegates = row.delegates.length
        ? row.delegates
            .slice(0, 4)
            .map((entry) => {
              const label = renderActorLabel(state, entry.delegateHash, { showHash: false });
              const via = entry.source === 'election' ? 'elected' : 'cachet';
              const delegateForm = person
                ? `
                  <form class="form-inline" method="post" action="/delegation" data-enhance="delegation">
                    <input type="hidden" name="intent" value="set" />
                    <input type="hidden" name="topic" value="${escapeHtml(row.label)}" />
                    <input type="hidden" name="delegateHash" value="${escapeHtml(entry.delegateHash)}" />
                    <button type="submit" class="ghost">Delegate ${escapeHtml(row.label)}</button>
                  </form>`
                : '';
              return `
                <div class="list-row">
                  <div>
                    <p class="small">${label}</p>
                    <p class="muted tiny">${escapeHtml(entry.groupName)} · ${escapeHtml(via)}</p>
                  </div>
                  <div>${delegateForm}</div>
                </div>
              `;
            })
            .join('')
        : '<p class="muted tiny">No delegate put forward yet — join a group above to help pick one.</p>';
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(row.label)}</span>
            ${groupNames}
          </div>
          <div class="list-stack">${delegates}</div>
        </article>
      `;
    })
    .join('\n');
  return `<div class="list-stack">${items}</div>`;
}
function renderSettings(group, policy) {
  const groupId = escapeHtml(group.id);
  return `
    <section class="panel stack" data-composer-section="group-settings" data-section-label="Group settings">
      <h2>Group settings</h2>
      <details class="note">
        <summary>Group policy</summary>
        <form class="form-inline" method="post" action="/groups/policy" data-enhance="groups">
          <input type="hidden" name="groupId" value="${groupId}" />
          <label>Election mode
            <select name="electionMode">
              <option value="priority" ${policy.electionMode === 'priority' ? 'selected' : ''}>Priority</option>
              <option value="vote" ${policy.electionMode === 'vote' ? 'selected' : ''}>Vote</option>
            </select>
          </label>
          <label>Conflict rule
            <select name="conflictRule">
              <option value="highest_priority" ${policy.conflictRule === 'highest_priority' ? 'selected' : ''}>Highest priority</option>
              <option value="prompt_user" ${policy.conflictRule === 'prompt_user' ? 'selected' : ''}>Prompt user</option>
            </select>
          </label>
          <label class="field checkbox">
            <input type="checkbox" name="categoryWeighted" ${policy.categoryWeighted ? 'checked' : ''} />
            <span>Weight by category</span>
          </label>
          <label class="field checkbox">
            <input type="checkbox" name="laneDiscussion" ${policy.lanes?.discussion ? 'checked' : ''} />
            <span>Internal discussion lane</span>
          </label>
          <label class="field checkbox">
            <input type="checkbox" name="lanePetitions" ${policy.lanes?.petitions ? 'checked' : ''} />
            <span>Internal proposals lane</span>
          </label>
          <label>Lane visibility
            <select name="lanesVisibility">
              <option value="members" ${policy.lanesVisibility !== 'public' ? 'selected' : ''}>Members only</option>
              <option value="public" ${policy.lanesVisibility === 'public' ? 'selected' : ''}>Readable by anyone</option>
            </select>
          </label>
          <label class="field checkbox">
            <input type="checkbox" name="adoptBranchElections" ${policy.adoptBranchElections ? 'checked' : ''} />
            <span>Adopt branch election results</span>
          </label>
          <button type="submit" class="ghost">Save policy</button>
        </form>
        <p class="muted tiny">Internal lanes are off by default. Items posted in them stay out of the Circle feed until a group admin or lane moderator moves them up a level.</p>
        <p class="muted tiny">Adopting branch elections lets this group use a branch's closed election for a category it has not voted on itself. Its own election always wins where it has one.</p>
      </details>
      <details class="note">
        <summary>Group categories</summary>
        <form class="form-inline" method="post" action="/groups/topics" data-enhance="groups">
          <input type="hidden" name="groupId" value="${groupId}" />
          <label>Categories (comma separated, use Parent / Child for subcategories)
            <input name="topics" value="${escapeHtml((group.topics || []).join(', '))}" placeholder="Energy, Energy / Solar" />
          </label>
          <button type="submit" class="ghost">Save categories</button>
        </form>
        <p class="muted tiny">Declared categories put this group in the category directory, so members can find who to delegate for them.</p>
      </details>
      <details class="note">
        <summary>Set preferred delegate</summary>
        <form class="form-inline" method="post" action="/groups/delegate" data-enhance="groups">
          <input type="hidden" name="groupId" value="${groupId}" />
          <label>Topic <input name="topic" placeholder="general" /></label>
          <label>Delegate <input name="delegateHash" placeholder="@handle" required /></label>
          <label>Priority <input name="priority" type="number" value="0" size="4" /></label>
          <button type="submit" class="ghost">Save</button>
        </form>
      </details>
    </section>`;
}

function renderDecisions(group, person, state, manage) {
  const groupId = escapeHtml(group.id);
  const canVote = isGroupMember(group, person?.pidHash) && evaluateAction(state, person, 'vote').allowed;
  const delegates = (group.delegates || []).map((delegate) => `
    <li>${escapeHtml(delegate.topic || 'general')} · ${renderActorLabel(state, delegate.delegateHash, { showHash: false })}
      <span class="muted small">Priority ${Number(delegate.priority) || 0}</span></li>`).join('');
  const elections = renderElections(listElections(state, group.id), state, { canVote, manage, voterHash: person?.pidHash });
  return `
    <section class="panel stack" data-composer-section="group-decisions" data-section-label="Group decisions">
      <h2>Delegate elections</h2>
      ${elections}
      <h3>Preferred delegates</h3>
      <p class="muted small">Group choices inform individual delegation. Each member can choose or override their own delegate.</p>
      ${delegates ? `<ul>${delegates}</ul>` : '<p class="muted small">No preferred delegates have been set.</p>'}
      ${manage ? `<details class="note">
        <summary>Start a new election</summary>
        <form class="stack" method="post" action="/groups" data-enhance="groups">
          <input type="hidden" name="action" value="startElection" />
          <input type="hidden" name="groupId" value="${groupId}" />
          <label class="field">
            <span>Topic</span>
            <input name="topic" placeholder="energy" />
          </label>
          <label class="field">
            <span>Candidates (@handles, comma separated)</span>
            <input name="candidates" placeholder="@giulia.ferrero, @marco.deluca" />
          </label>
          <button class="ghost" type="submit">Start election</button>
        </form>
      </details>` : ''}
    </section>`;
}

// Decisions reads like a ballot record: elections that still need a vote come
// first, then the current result for each category, and earlier results for the
// same category fold into a disclosure so a long history stays scannable.
function renderElections(elections, state, { canVote, manage, voterHash }) {
  if (!elections.length) return '<p class="muted small">No elections yet. Group admins can start one for a category the group covers.</p>';
  const open = elections.filter((election) => election.status !== 'closed');
  const closed = elections
    .filter((election) => election.status === 'closed')
    .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));
  const current = [];
  const earlier = [];
  const seenTopics = new Set();
  for (const election of closed) {
    const topic = String(election.topic || 'general').trim().toLowerCase();
    if (seenTopics.has(topic)) earlier.push(election);
    else {
      seenTopics.add(topic);
      current.push(election);
    }
  }
  const card = (election) => renderElectionCard(election, state, { canVote, manage, voterHash });
  return `
    <h3>Open elections <span class="muted small">(${open.length})</span></h3>
    ${open.length ? `<ul class="election-list">${open.map(card).join('')}</ul>` : '<p class="muted small">No election is open.</p>'}
    <h3>Current results <span class="muted small">(${current.length})</span></h3>
    ${current.length ? `<ul class="election-list">${current.map(card).join('')}</ul>` : '<p class="muted small">No election has closed yet.</p>'}
    ${earlier.length ? `<details class="note">
      <summary>Earlier results (${earlier.length})</summary>
      <ul class="election-list">${earlier.map(card).join('')}</ul>
    </details>` : ''}
  `;
}

function describeWinMethod(winner) {
  const rounds = Number.isFinite(winner?.rounds) ? winner.rounds : null;
  switch (winner?.method) {
    case 'majority': return 'First-preference majority';
    case 'ranked': return rounds ? `Won on transfers after ${rounds} rounds` : 'Won on transfers';
    case 'tie_break': return rounds ? `Tie broken after ${rounds} rounds` : 'Tie broken';
    case 'fallback': return 'Last remaining candidate';
    default: return '';
  }
}

function renderElectionCard(election, state, { canVote, manage, voterHash }) {
  const tally = election.votes || [];
  const isOpen = election.status !== 'closed';
  const topicLabel = escapeHtml(election.topic || 'general');
  const electionId = escapeHtml(election.id || '');
  const candidates = (election.candidates || []).map((c) => ({
    value: escapeHtml(String(c)),
    label: `@${escapeHtml(resolveHandleForHash(state, c))}`,
  }));
  const ownBallot = voterHash ? tally.find((vote) => vote.voterHash === voterHash) : null;
  const winner = isOpen ? null : pickWinner(election, state);
  const method = describeWinMethod(winner);
  const closedAt = formatTimestamp(election.closedAt);
  const candidateList = candidates.length
    ? `<p class="small">Candidates: ${(election.candidates || []).map((c) => renderActorLabel(state, c, { showHash: false })).join(', ')}</p>`
    : '';
  // A member changing their vote starts from the ranking they already cast.
  const options = (placeholder, current) => `${placeholder ? `<option value="">${placeholder}</option>` : ''}${candidates
    .map((c) => `<option value="${c.value}"${current && escapeHtml(String(current)) === c.value ? ' selected' : ''}>${c.label}</option>`).join('')}`;
  return `
    <li>
      <article class="discussion election-card election-card--${isOpen ? 'open' : 'closed'}"${electionId ? ` id="election-${electionId}"` : ''}>
        <header class="discussion__meta">
          <span class="pill stage stage--${isOpen ? 'vote' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
          <h4 class="election-card__topic">${topicLabel}</h4>
          ${renderPreviewPill(election)}
          ${renderIssuerPill(election)}
        </header>
        ${isOpen ? candidateList : ''}
        ${winner?.candidateHash ? `<p><strong>Winner:</strong> ${renderActorLabel(state, winner.candidateHash, { showHash: false })}</p>` : ''}
        ${!isOpen && !winner?.candidateHash ? '<p class="muted small">Closed without a winner.</p>' : ''}
        <p class="muted small">${tally.length} ${tally.length === 1 ? 'ballot' : 'ballots'}${method ? ` · ${escapeHtml(method)}` : ''}${closedAt ? ` · Closed <time datetime="${escapeHtml(election.closedAt)}">${escapeHtml(closedAt)}</time>` : ''}${ownBallot ? ' · You voted' : ''}</p>
        ${isOpen && canVote ? `
          <form class="form-inline" method="post" action="/groups" data-enhance="groups">
            <input type="hidden" name="action" value="voteElection" />
            <input type="hidden" name="electionId" value="${electionId}" />
            <select name="candidateHash" aria-label="First choice">${options('', ownBallot?.candidateHash)}</select>
            <select name="secondChoiceHash" aria-label="Second choice">${options('Second choice (optional)', ownBallot?.secondChoiceHash)}</select>
            <select name="thirdChoiceHash" aria-label="Third choice">${options('Third choice (optional)', ownBallot?.thirdChoiceHash)}</select>
            <button type="submit" class="ghost">${ownBallot ? 'Change vote' : 'Vote'}</button>
          </form>` : ''}
        ${isOpen && manage ? `
          <form class="form-inline" method="post" action="/groups" data-enhance="groups">
            <input type="hidden" name="action" value="closeElection" />
            <input type="hidden" name="electionId" value="${electionId}" />
            <button type="submit" class="ghost">Close and pick winner</button>
          </form>` : ''}
      </article>
    </li>
  `;
}
