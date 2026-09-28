import { getPerson } from '../../identity/person.js';
import { evaluateAction } from '../../circle/policy.js';
import { isModuleEnabled } from '../../circle/modules.js';
import {
  createGroup,
  findGroupById,
  isGroupAdmin,
  isGroupMember,
  joinGroup,
  leaveGroup,
  listGroups,
  setGroupDelegate,
  setGroupMemberRole,
  setGroupTopics,
  GROUP_ROLES,
  canModerateGroupLane,
  getGroupMemberRole,
} from '../../groups/groups.js';
import {
  buildGroupTree,
  formatGroupLineage,
  listChildGroups,
  validateParent,
} from '../../groups/groupTree.js';
import { buildCategoryDirectory } from '../../groups/categoryDirectory.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { createNotification } from '../../messaging/notifications.js';
import { getGroupPolicy, normalizeLanes, setGroupPolicy } from '../../groups/groupPolicy.js';
import { startElection, listElections, castElectionVote, pickWinner, closeElection } from '../../groups/groupElections.js';
import { logTransaction } from '../../transactions/registry.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../../../interfaces/http/views/moduleGate.js';
import { renderIssuerPill, renderPreviewPill } from '../../../interfaces/http/views/shared.js';
import { renderActorLabel, resolveHandleForHash, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { findSessionByHandle, findSessionByHash } from '../../identity/sessions.js';

// Delegates and election candidates may be entered by @handle or by raw hash. Resolve to
// a canonical pid hash so the stored value is always a hash, and the UI can render @handle.
function resolveActorHash(state, input) {
  const value = String(input || '').trim().replace(/^@+/, '');
  if (!value) return '';
  const byHandle = findSessionByHandle(state, value);
  if (byHandle?.pidHash) return byHandle.pidHash;
  const byHash = findSessionByHash(state, value);
  if (byHash?.pidHash) return byHash.pidHash;
  return value;
}

export async function renderGroups({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'groups' });
  }
  const person = getPerson(req, state);
  const groups = listGroups(state).map((group) => ({
    ...group,
    policy: getGroupPolicy(state, group.id),
    elections: listElections(state, group.id),
  }));
  const html = await renderPage(
    'groups',
    {
      groups: renderGroupList(groups, person, state),
      groupCategories: renderCategoryDirectory(state, person),
      parentGroupOptions: renderParentOptions(state),
      person,
      personHandle: resolvePersonHandle(person),
      personHash: person?.pidHash || '',
      roleLabel: person?.role || 'guest',
      circlePolicyNote: 'Party Circle policy governs quorum/votes; groups manage internal delegate preferences and hierarchies.',
    },
    { wantsPartial, title: 'Groups', state },
  );
  return sendHtml(res, html);
}

export async function createOrJoinGroup({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const action = body.action || 'create';

  if (action === 'join') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to join a group.' });
    }
    const permission = evaluateAction(state, person, 'post');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Group join blocked.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const groupRef = findGroupById(state, groupId);
    if (!groupRef) {
      return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const group = await joinGroup({ groupId, person, state });
    if (group) {
      await logTransaction(state, {
        type: 'group_join',
        actorHash: person?.pidHash || 'anonymous',
        payload: { groupId },
      });
    }
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'leave') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to leave a group.' });
    }
    const permission = evaluateAction(state, person, 'post');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Group leave blocked.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const groupRef = findGroupById(state, groupId);
    if (!groupRef) {
      return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const group = await leaveGroup({ groupId, person, state });
    if (group) {
      await logTransaction(state, {
        type: 'group_leave',
        actorHash: person?.pidHash || 'anonymous',
        payload: { groupId },
      });
    }
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'startElection') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to start elections.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const group = findGroupById(state, groupId);
    if (!group) {
      return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const permission = evaluateAction(state, person, 'moderate');
    if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
      return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
    }
    const topic = sanitizeText(body.topic || 'general', 64);
    const candidates = (body.candidates || '')
      .split(',')
      .map((v) => sanitizeText(v, 80))
      .filter(Boolean)
      .map((v) => resolveActorHash(state, v));
    const election = await startElection({ groupId, topic, candidates, state });
    if (election) {
      await logTransaction(state, {
        type: 'group_election_start',
        actorHash: person?.pidHash || 'anonymous',
        payload: { groupId, electionId: election.id, topic, candidates: candidates.length },
      });
    }
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'voteElection') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to vote in a group election.' });
    }
    const permission = evaluateAction(state, person, 'vote');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Election voting blocked.' });
    }
    const electionId = sanitizeText(body.electionId || '', 80);
    const electionRef = (state.groupElections || []).find((entry) => entry.id === electionId);
    if (!electionRef) {
      return sendJson(res, 404, { error: 'election_not_found', message: 'Election not found.' });
    }
    const group = findGroupById(state, electionRef.groupId);
    if (!group) {
      return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
    }
    if (!isGroupMember(group, person.pidHash)) {
      return sendJson(res, 401, { error: 'group_membership_required', message: 'Join the group to vote in its elections.' });
    }
    const candidateHash = resolveActorHash(state, sanitizeText(body.candidateHash || '', 80));
    const secondChoiceHash = resolveActorHash(state, sanitizeText(body.secondChoiceHash || '', 80));
    const thirdChoiceHash = resolveActorHash(state, sanitizeText(body.thirdChoiceHash || '', 80));
    const election = await castElectionVote({ electionId, voterHash: person?.pidHash, candidateHash, secondChoiceHash, thirdChoiceHash, state });
    if (election) {
      await logTransaction(state, {
        type: 'group_election_vote',
        actorHash: person?.pidHash || 'anonymous',
        payload: { electionId, candidateHash, secondChoiceHash: secondChoiceHash || null, thirdChoiceHash: thirdChoiceHash || null },
      });
    }
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'closeElection') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to close elections.' });
    }
    const electionId = sanitizeText(body.electionId || '', 80);
    const electionRef = (state.groupElections || []).find((entry) => entry.id === electionId);
    if (!electionRef) {
      return sendJson(res, 404, { error: 'election_not_found', message: 'Election not found.' });
    }
    const group = findGroupById(state, electionRef.groupId);
    if (!group) {
      return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const permission = evaluateAction(state, person, 'moderate');
    if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
      return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
    }
    const election = await closeElection({ electionId, state });
    let winner = null;
    if (election) {
      winner = pickWinner(election, state);
      if (winner) {
        await setGroupDelegate({
          groupId: election.groupId,
          topic: election.topic,
          delegateHash: winner.candidateHash,
          priority: 10,
          provider: 'group-election',
          state,
        });
      }
    }
    if (election) {
      await logTransaction(state, {
        type: 'group_election_close',
        actorHash: person?.pidHash || 'anonymous',
        payload: { electionId, groupId: election.groupId, winner: winner?.candidateHash || null },
      });
    }
    return renderGroups({ req, res, state, wantsPartial });
  }

  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to create group.' });
  }

  const name = sanitizeText(body.name || '', 120);
  const description = sanitizeText(body.description || '', 400);
  const topics = (body.topics || '').split(',').map((t) => sanitizeText(t, 64)).filter(Boolean);
  // A group may be a branch of another — a party's think tank, a divergent wing. The parent
  // is validated here for existence, self-reference, cycles and depth.
  const parentCheck = validateParent(state, { parentId: sanitizeText(body.parentId || '', 80) || null });
  if (!parentCheck.ok) {
    return sendJson(res, parentCheck.error === 'parent_not_found' ? 404 : 400, {
      error: parentCheck.error,
      message: parentCheck.message,
    });
  }
  // Register declared categories in the topic registry so group categories and site
  // categories are the same nested tree, not two vocabularies that drift apart.
  for (const label of topics) {
    await ensureTopicPath(state, label, { source: 'group' });
  }
  const group = await createGroup({
    name,
    description,
    topics,
    parentId: parentCheck.parentId,
    creatorHash: person?.pidHash,
    state,
  });
  await createNotification(state, {
    type: 'group_created',
    recipientHash: person?.pidHash || 'broadcast',
    message: `Group "${group.name}" created.`,
  });
  await logTransaction(state, {
    type: 'group_create',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId: group.id, name: group.name },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function setGroupDelegateRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  if (!group) {
    return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to set delegates.' });
  }
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
    return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = resolveActorHash(state, sanitizeText(body.delegateHash || '', 80));
  const priority = Number(body.priority || 0);
  await setGroupDelegate({ groupId, topic, delegateHash, priority, provider: sanitizeText(body.provider || 'local', 64), state });
  await createNotification(state, {
    type: 'group_delegate',
    recipientHash: person?.pidHash || 'broadcast',
    message: `Updated delegate for topic "${topic}" in group.`,
  });
  await logTransaction(state, {
    type: 'group_delegate_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, topic, delegateHash, priority },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function setGroupMemberRoleRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  if (!group) {
    return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to set group roles.' });
  }
  // Roles are an admin power on purpose: a lane moderator who could appoint lane moderators
  // would be an admin by another name.
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
    return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const memberHash = resolveActorHash(state, sanitizeText(body.memberHash || '', 80));
  const role = sanitizeText(body.role || 'member', 24);
  const result = await setGroupMemberRole({ groupId, memberHash, role, state });
  if (!result.ok) {
    return sendJson(res, result.error === 'group_not_found' ? 404 : 400, {
      error: result.error,
      message: result.message || 'Could not set that role.',
    });
  }
  await logTransaction(state, {
    type: 'group_role_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, memberHash, role },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function setGroupTopicsRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  if (!group) {
    return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to set group categories.' });
  }
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
    return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const topics = (body.topics || '')
    .split(',')
    .map((entry) => sanitizeText(entry, 64))
    .filter(Boolean)
    .slice(0, 12);
  // Group categories join the same nested topic tree the site uses, so "Energy / Solar"
  // declared by a branch group is the same category a delegation can be scoped to.
  for (const label of topics) {
    await ensureTopicPath(state, label, { source: 'group' });
  }
  await setGroupTopics({ groupId, topics, state });
  await logTransaction(state, {
    type: 'group_topics_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, topics },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function updateGroupPolicyRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  if (!group) {
    return sendJson(res, 404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Login required to update group policy.' });
  }
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed && !isGroupAdmin(group, person.pidHash)) {
    return sendJson(res, 401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const electionMode = sanitizeText(body.electionMode || 'priority', 32);
  const conflictRule = sanitizeText(body.conflictRule || 'highest_priority', 32);
  const categoryWeighted = Boolean(body.categoryWeighted);
  const lanes = normalizeLanes({
    discussion: Boolean(body.laneDiscussion),
    petitions: Boolean(body.lanePetitions),
  });
  const lanesVisibility = sanitizeText(body.lanesVisibility || 'members', 16);
  const adoptBranchElections = Boolean(body.adoptBranchElections);
  await setGroupPolicy(state, {
    groupId,
    electionMode,
    conflictRule,
    categoryWeighted,
    lanes,
    lanesVisibility,
    adoptBranchElections,
  });
  await logTransaction(state, {
    type: 'group_policy_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, electionMode, conflictRule, categoryWeighted, lanes, lanesVisibility, adoptBranchElections },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

// Group roles are visible to members so it is clear who can act on the lanes, and editable
// by admins. Kept minimal on purpose: the point is a moderation role that is not ownership.
function renderRolePanel(group, person, state) {
  const viewerIsAdmin = person?.pidHash ? isGroupAdmin(group, person.pidHash) : false;
  const members = group.members || [];
  if (!members.length) return '';
  const rows = members
    .map((hash) => {
      const role = getGroupMemberRole(group, hash) || 'member';
      const label = renderActorLabel(state, hash, { showHash: false });
      const control = viewerIsAdmin
        ? `
          <form class="form-inline" method="post" action="/groups/roles" data-enhance="groups">
            <input type="hidden" name="groupId" value="${escapeHtml(group.id)}" />
            <input type="hidden" name="memberHash" value="${escapeHtml(hash)}" />
            <select name="role">
              ${GROUP_ROLES.map(
                (value) =>
                  `<option value="${escapeHtml(value)}" ${role === value ? 'selected' : ''}>${escapeHtml(formatRoleLabel(value))}</option>`,
              ).join('')}
            </select>
            <button type="submit" class="ghost">Set role</button>
          </form>`
        : `<span class="pill ghost">${escapeHtml(formatRoleLabel(role))}</span>`;
      return `<div class="list-row"><div><p class="small">${label}</p></div><div>${control}</div></div>`;
    })
    .join('');
  return `
    <details class="note">
      <summary>Members and roles</summary>
      <div class="list-stack">${rows}</div>
      <p class="muted tiny">Lane moderators can promote items and decide promotion requests. They cannot change policy, categories, delegates or roles.</p>
    </details>
  `;
}

function formatRoleLabel(role) {
  if (role === 'laneModerator') return 'Lane moderator';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

function renderParentOptions(state) {
  const rows = buildGroupTree(listGroups(state));
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
function renderCategoryDirectory(state, person) {
  const rows = buildCategoryDirectory(state);
  if (!rows.length) {
    return '<p class="muted">No group has declared a category yet. Add topics to a group to appear here.</p>';
  }
  const items = rows
    .map((row) => {
      const groupNames = row.groups
        .map((group) => {
          const lineage = group.lineage.length ? `${group.lineage.join(' / ')} / ` : '';
          return `<span class="pill ghost">${escapeHtml(lineage + group.name)}</span>`;
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

function renderGroupList(groups, person, state) {
  if (!groups.length) return '<p class="muted">No groups yet.</p>';
  return buildGroupTree(groups)
    .map(({ group, depth }) => {
      const member = person?.pidHash ? group.members?.includes(person.pidHash) : false;
      const moderator = person ? evaluateAction(state, person, 'moderate').allowed : false;
      const policy = group.policy || {};
      const delegates = (group.delegates || [])
        .map((d) => {
          const topic = escapeHtml(String(d.topic || 'general'));
          const delegateLink = d.delegateHash
            ? `<a href="/delegates/${escapeHtml(String(d.delegateHash))}" data-partial>${renderActorLabel(state, d.delegateHash, { showHash: false })}</a>`
            : '<span class="muted">unassigned</span>';
          const priority = Number(d.priority) || 0;
          return `<li>${topic} → ${delegateLink} (prio ${priority})</li>`;
        })
        .join('');
      const elections = renderElections(group.elections || [], person, state);
      const topicLabel = group.topics?.length ? escapeHtml(group.topics.join(', ')) : 'general';
      const name = escapeHtml(group.name || 'Group');
      const description = escapeHtml(group.description || '');
      const groupId = escapeHtml(group.id || '');
      const lineage = formatGroupLineage(state, group);
      const branchPill = lineage ? `<span class="pill ghost">Branch of ${escapeHtml(lineage)}</span>` : '';
      const children = listChildGroups(state, group.id);
      const childNote = children.length
        ? `<p class="muted tiny">Branches: ${children.map((child) => escapeHtml(child.name || 'Group')).join(', ')}</p>`
        : '';
      const lanes = policy.lanes || {};
      const canReadLanes = member || moderator;
      const laneLinks = [
        lanes.discussion && canReadLanes
          ? `<a class="pill ghost" href="/discussion?group=${groupId}" data-partial>Group discussion</a>`
          : '',
        lanes.petitions && canReadLanes
          ? `<a class="pill ghost" href="/petitions?group=${groupId}" data-partial>Group proposals</a>`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      const laneNote =
        (lanes.discussion || lanes.petitions) && !canReadLanes
          ? '<p class="muted tiny">This group runs internal lanes. Join to read them.</p>'
          : '';
      return `
        <article class="discussion" style="margin-left: ${Math.min(depth, 3) * 1.25}rem">
          <div class="discussion__meta">
            <span class="pill">Group</span>
            ${branchPill}
            ${renderPreviewPill(group)}
            <span class="muted small">${topicLabel}</span>
          </div>
          <h3>${name}</h3>
          <p>${description}</p>
          <p class="muted small">Members: ${group.members?.length || 0}</p>
          ${childNote}
          ${laneLinks ? `<div class="discussion__meta">${laneLinks}</div>` : ''}
          ${laneNote}
          <div class="muted small">Delegates:<ul>${delegates || '<li>None</li>'}</ul></div>
          <form class="form-inline" method="post" action="/groups" data-enhance="groups">
            <input type="hidden" name="groupId" value="${groupId}" />
            <input type="hidden" name="action" value="${member ? 'leave' : 'join'}" />
            <button type="submit" class="ghost">${member ? 'Leave' : 'Join'}</button>
          </form>
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
          ${renderRolePanel(group, person, state)}
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
          <details class="note">
            <summary>Delegate election</summary>
            ${elections}
            <p class="muted small">Start a new election</p>
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
          </details>
        </article>
      `;
    })
    .join('\n');
}

function renderElections(elections, person, state) {
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
            election.status === 'open'
              ? `
            <form class="form-inline" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="voteElection" />
              <input type="hidden" name="electionId" value="${electionId}" />
              <select name="candidateHash">
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <select name="secondChoiceHash">
                <option value="">Second choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <select name="thirdChoiceHash">
                <option value="">Third choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c.value}">${c.label}</option>`)
                  .join('')}
              </select>
              <button type="submit" class="ghost">Vote</button>
            </form>
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
