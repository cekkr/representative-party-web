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
  const elections = renderElections(listElections(state, group.id), state, { canVote, manage });
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

function renderElections(elections, state, { canVote, manage }) {
  if (!elections.length) return '<p class="muted small">No elections.</p>';
  return elections
    .map((election) => {
      const tally = election.votes || [];
      const previewPill = renderPreviewPill(election);
      const issuerPill = renderIssuerPill(election);
      const topicLabel = escapeHtml(election.topic || 'general');
      const statusLabel = escapeHtml(election.status || 'open');
      const electionId = escapeHtml(election.id || '');
      const candidates = (election.candidates || []).map((c) => ({
        value: escapeHtml(String(c)),
        label: `@${escapeHtml(resolveHandleForHash(state, c))}`,
      }));
      const winner = election.status === 'closed' ? pickWinner(election, state) : null;
      const winnerMethod = winner?.method ? escapeHtml(winner.method) : '';
      const winnerRounds = Number.isFinite(winner?.rounds) ? winner.rounds : null;
      const winnerLabel = winner?.candidateHash
        ? `Winner: ${renderActorLabel(state, winner.candidateHash, { showHash: false })}${winnerMethod ? ` (method ${winnerMethod}${winnerRounds ? `, rounds ${winnerRounds}` : ''})` : ''}`
        : '';
      const closedAt = formatTimestamp(election.closedAt);
      return `
        <div class="muted small">
          <div class="discussion__meta">
            <span class="pill ghost">Election</span>
            <span class="pill">${topicLabel}</span>
            ${previewPill}
            ${issuerPill}
            <span class="muted tiny">Status: ${statusLabel}</span>
          </div>
          ${
            election.status === 'open' && canVote
              ? `
            <form class="form-inline" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="voteElection" />
              <input type="hidden" name="electionId" value="${electionId}" />
              <select name="candidateHash" aria-label="First choice">
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <select name="secondChoiceHash" aria-label="Second choice">
                <option value="">Second choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <select name="thirdChoiceHash" aria-label="Third choice">
                <option value="">Third choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <button type="submit" class="ghost">Vote</button>
            </form>
          ` : ''
          }
          ${election.status === 'open' && manage ? `
            <form class="form-inline" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="closeElection" />
              <input type="hidden" name="electionId" value="${electionId}" />
              <button type="submit" class="ghost">Close and pick winner</button>
            </form>
          `
              : ''
          }
          <p>Votes: ${tally.length}</p>
          ${winnerLabel ? `<p>${winnerLabel}</p>` : ''}
          ${closedAt ? `<p class="muted tiny">Closed: ${closedAt}</p>` : ''}
        </div>
      `;
    })
    .join('\n');
}
