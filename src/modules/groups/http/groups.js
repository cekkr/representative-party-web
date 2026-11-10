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
} from '../../groups/groups.js';
import { validateParent } from '../groupTree.js';
import { readGroupScope } from '../groupScope.js';
import { readGroupActivityFamily } from '../groupActivity.js';
import {
  GROUP_VIEWS,
  GROUPS_PAGE_SIZE,
  groupHref,
  groupWorkspaceData,
  listGroupDirectoryRows,
  renderCategoryDirectory,
  renderGroupList,
  renderParentOptions,
} from './groupView.js';
import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { createNotification } from '../../messaging/notifications.js';
import { normalizeLanes, setGroupPolicy } from '../../groups/groupPolicy.js';
import { startElection, castElectionVote, pickWinner, closeElection } from '../../groups/groupElections.js';
import { logTransaction } from '../../transactions/registry.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../../../interfaces/http/views/moduleGate.js';
import { findSessionByHandle, findSessionByHash } from '../../identity/sessions.js';
import {
  prefersHtmlNavigation,
  renderFlashNotice,
  setFlashNotice,
} from '../../../interfaces/http/views/formOutcome.js';
import { GROUP_NOTICES, groupRefusalCode } from '../groupNotices.js';

// A browser form returns to the group it acted on with a notice whose tone
// follows the outcome; script clients keep the structured JSON refusal. A
// refusal points at a readable view (never Settings, which 404s for a
// non-manager), and a missing record falls back to the directory.
function refuseGroupForm(req, res, status, payload, href = '/groups', family = '') {
  if (!prefersHtmlNavigation(req)) return sendJson(res, status, payload);
  const code = groupRefusalCode(payload?.error, family);
  setFlashNotice(res, 'groups', code);
  return sendRedirect(res, code === 'not-found' ? '/groups' : href);
}

function completeGroupForm(res, href, code) {
  setFlashNotice(res, 'groups', code);
  return sendRedirect(res, href);
}

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

function canManageGroup(state, person, group) {
  if (!person) return false;
  return evaluateAction(state, person, 'moderate').allowed ||
    (isGroupAdmin(group, person.pidHash) && evaluateAction(state, person, 'post').allowed);
}

export async function renderGroups({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'groups')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'groups' });
  }
  const person = getPerson(req, state);
  const groups = listGroups(state);
  const groupId = readGroupScope(url.searchParams);
  if (groupId) {
    const group = groups.find(({ id }) => id === groupId);
    const requestedView = url.searchParams.get('view');
    const view = GROUP_VIEWS.includes(requestedView) ? requestedView : 'overview';
    const manage = group && canManageGroup(state, person, group);
    if (!group || (view === 'settings' && !manage)) {
      const html = await renderPage('group-unavailable', { person, pageKey: 'groups' }, {
        wantsPartial, title: 'Group workspace unavailable', state,
      });
      return sendHtml(res, html, {}, 404);
    }
    const html = await renderPage('group-workspace', {
      ...groupWorkspaceData(group, person, state, {
        view,
        manage,
        groups,
        activity: { kind: readGroupActivityFamily(url.searchParams), page: parsePage(url.searchParams.get('page')) },
      }),
      groupNotice: renderFlashNotice(req, res, 'groups', GROUP_NOTICES),
      person,
      pageKey: 'groups',
    }, { wantsPartial, title: group.name || 'Group', state });
    return sendHtml(res, html);
  }
  const canCreate = evaluateAction(state, person, 'post').allowed;
  const query = sanitizeText(url.searchParams.get('q') || '', 64);
  const rows = listGroupDirectoryRows(groups, { query });
  const pageInfo = paginate(rows, { page: parsePage(url.searchParams.get('page')), pageSize: GROUPS_PAGE_SIZE });
  const countLabel = `${rows.length} ${rows.length === 1 ? 'group' : 'groups'}`;
  const html = await renderPage(
    'groups',
    {
      groups: renderGroupList(groups, { rows: pageInfo.items, query }),
      groupsPager: renderPager(pageInfo, { baseHref: '/groups', query: { q: query }, label: 'groups', order: 'directory' }),
      groupsQuery: escapeHtml(query),
      groupsCount: escapeHtml(query ? `${countLabel} match “${query}”` : `${countLabel} in this Circle`),
      groupsClear: query ? '<a class="ghost" href="/groups" data-partial>Clear search</a>' : '',
      groupCategories: renderCategoryDirectory(state, person),
      parentGroupOptions: renderParentOptions(groups),
      createAction: canCreate ? '<a class="cta" href="#group-create">Create a group</a>' : '',
      createHidden: canCreate ? '' : 'hidden',
      groupsNotice: renderFlashNotice(req, res, 'groups', GROUP_NOTICES),
      person,
    },
    { wantsPartial, title: 'Groups', state },
  );
  return sendHtml(res, html);
}

export async function createOrJoinGroup({ req, res, state }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const action = body.action || 'create';
  const returnView = ['members', 'decisions', 'activity'].includes(body.returnView) ? body.returnView : 'overview';
  const bodyGroupId = sanitizeText(body.groupId || '', 80);
  let back = bodyGroupId && findGroupById(state, bodyGroupId) ? groupHref(bodyGroupId, returnView) : '/groups';
  const deny = (status, payload, family) => refuseGroupForm(req, res, status, payload, back, family);

  if (action === 'join') {
    if (!person) {
      return deny(401, { error: 'verification_required', message: 'Login required to join a group.' });
    }
    const permission = evaluateAction(state, person, 'post');
    if (!permission.allowed) {
      return deny(401, { error: permission.reason, message: permission.message || 'Group join blocked.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const groupRef = findGroupById(state, groupId);
    if (!groupRef) {
      return deny(404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const group = await joinGroup({ groupId, person, state });
    if (group) {
      await logTransaction(state, {
        type: 'group_join',
        actorHash: person?.pidHash || 'anonymous',
        payload: { groupId },
      });
    }
    return completeGroupForm(res, groupHref(groupId, returnView), group ? 'joined' : 'not-applied');
  }

  if (action === 'leave') {
    if (!person) {
      return deny(401, { error: 'verification_required', message: 'Login required to leave a group.' });
    }
    const permission = evaluateAction(state, person, 'post');
    if (!permission.allowed) {
      return deny(401, { error: permission.reason, message: permission.message || 'Group leave blocked.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const groupRef = findGroupById(state, groupId);
    if (!groupRef) {
      return deny(404, { error: 'group_not_found', message: 'Group not found.' });
    }
    const group = await leaveGroup({ groupId, person, state });
    if (group) {
      await logTransaction(state, {
        type: 'group_leave',
        actorHash: person?.pidHash || 'anonymous',
        payload: { groupId },
      });
    }
    return completeGroupForm(res, groupHref(groupId, returnView), group ? 'left' : 'not-applied');
  }

  if (action === 'startElection') {
    if (!person) {
      return deny(401, { error: 'verification_required', message: 'Login required to start elections.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const group = findGroupById(state, groupId);
    if (!group) {
      return deny(404, { error: 'group_not_found', message: 'Group not found.' });
    }
    back = groupHref(groupId, 'decisions');
    if (!canManageGroup(state, person, group)) {
      return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
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
    return completeGroupForm(res, groupHref(groupId, 'decisions'), election ? 'election-started' : 'not-applied');
  }

  if (action === 'voteElection') {
    if (!person) {
      return deny(401, { error: 'verification_required', message: 'Login required to vote in a group election.' });
    }
    const permission = evaluateAction(state, person, 'vote');
    if (!permission.allowed) {
      return deny(401, { error: permission.reason, message: permission.message || 'Election voting blocked.' });
    }
    const electionId = sanitizeText(body.electionId || '', 80);
    const electionRef = (state.groupElections || []).find((entry) => entry.id === electionId);
    if (!electionRef) {
      return deny(404, { error: 'election_not_found', message: 'Election not found.' });
    }
    const group = findGroupById(state, electionRef.groupId);
    if (!group) {
      return deny(404, { error: 'group_not_found', message: 'Group not found.' });
    }
    back = groupHref(group.id, 'decisions');
    if (!isGroupMember(group, person.pidHash)) {
      return deny(401, { error: 'group_membership_required', message: 'Join the group to vote in its elections.' });
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
    return completeGroupForm(res, groupHref(group.id, 'decisions'), election ? 'ballot-cast' : 'not-applied');
  }

  if (action === 'closeElection') {
    if (!person) {
      return deny(401, { error: 'verification_required', message: 'Login required to close elections.' });
    }
    const electionId = sanitizeText(body.electionId || '', 80);
    const electionRef = (state.groupElections || []).find((entry) => entry.id === electionId);
    if (!electionRef) {
      return deny(404, { error: 'election_not_found', message: 'Election not found.' });
    }
    const group = findGroupById(state, electionRef.groupId);
    if (!group) {
      return deny(404, { error: 'group_not_found', message: 'Group not found.' });
    }
    back = groupHref(group.id, 'decisions');
    if (!canManageGroup(state, person, group)) {
      return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
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
    const closedCode = !election ? 'not-applied' : winner ? 'election-closed' : 'election-closed-no-winner';
    return completeGroupForm(res, groupHref(group.id, 'decisions'), closedCode);
  }

  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return deny(401, { error: permission.reason, message: permission.message || 'Not allowed to create group.' });
  }

  const name = sanitizeText(body.name || '', 120);
  const description = sanitizeText(body.description || '', 400);
  const topics = (body.topics || '').split(',').map((t) => sanitizeText(t, 64)).filter(Boolean);
  // A group may be a branch of another — a party's think tank, a divergent wing. The parent
  // is validated here for existence, self-reference, cycles and depth.
  const parentCheck = validateParent(state, { parentId: sanitizeText(body.parentId || '', 80) || null });
  if (!parentCheck.ok) {
    return deny(parentCheck.error === 'parent_not_found' ? 404 : 400, {
      error: parentCheck.error,
      message: parentCheck.message,
    }, 'parent');
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
    groupId: group.id,
    message: `Group "${group.name}" created.`,
  });
  await logTransaction(state, {
    type: 'group_create',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId: group.id, name: group.name },
  });
  return completeGroupForm(res, groupHref(group.id), 'created');
}

export async function setGroupDelegateRoute({ req, res, state }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  const back = group ? groupHref(groupId) : '/groups';
  const deny = (status, payload, family) => refuseGroupForm(req, res, status, payload, back, family);
  if (!group) {
    return deny(404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return deny(401, { error: 'verification_required', message: 'Login required to set delegates.' });
  }
  if (!canManageGroup(state, person, group)) {
    return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = resolveActorHash(state, sanitizeText(body.delegateHash || '', 80));
  const priority = Number(body.priority || 0);
  const saved = await setGroupDelegate({ groupId, topic, delegateHash, priority, provider: sanitizeText(body.provider || 'local', 64), state });
  await createNotification(state, {
    type: 'group_delegate',
    recipientHash: person?.pidHash || 'broadcast',
    groupId,
    message: `Updated delegate for topic "${topic}" in group.`,
  });
  await logTransaction(state, {
    type: 'group_delegate_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, topic, delegateHash, priority },
  });
  return completeGroupForm(res, groupHref(groupId, 'settings'), saved ? 'delegate-saved' : 'not-applied');
}

export async function setGroupMemberRoleRoute({ req, res, state }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  const back = group ? groupHref(groupId, 'members') : '/groups';
  const deny = (status, payload, family) => refuseGroupForm(req, res, status, payload, back, family);
  if (!group) {
    return deny(404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return deny(401, { error: 'verification_required', message: 'Login required to set group roles.' });
  }
  // Roles are an admin power on purpose: a lane moderator who could appoint lane moderators
  // would be an admin by another name.
  if (!canManageGroup(state, person, group)) {
    return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
  }
  const memberHash = resolveActorHash(state, sanitizeText(body.memberHash || '', 80));
  const role = sanitizeText(body.role || 'member', 24);
  const result = await setGroupMemberRole({ groupId, memberHash, role, state });
  if (!result.ok) {
    return deny(result.error === 'group_not_found' ? 404 : 400, {
      error: result.error,
      message: result.message || 'Could not set that role.',
    }, 'role');
  }
  await logTransaction(state, {
    type: 'group_role_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, memberHash, role },
  });
  return completeGroupForm(res, groupHref(groupId, 'members'), 'role-saved');
}

export async function setGroupTopicsRoute({ req, res, state }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  const back = group ? groupHref(groupId) : '/groups';
  const deny = (status, payload, family) => refuseGroupForm(req, res, status, payload, back, family);
  if (!group) {
    return deny(404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return deny(401, { error: 'verification_required', message: 'Login required to set group categories.' });
  }
  if (!canManageGroup(state, person, group)) {
    return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
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
  return completeGroupForm(res, groupHref(groupId, 'settings'), 'categories-saved');
}

export async function updateGroupPolicyRoute({ req, res, state }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups', state });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const group = findGroupById(state, groupId);
  const back = group ? groupHref(groupId) : '/groups';
  const deny = (status, payload, family) => refuseGroupForm(req, res, status, payload, back, family);
  if (!group) {
    return deny(404, { error: 'group_not_found', message: 'Group not found.' });
  }
  if (!person) {
    return deny(401, { error: 'verification_required', message: 'Login required to update group policy.' });
  }
  if (!canManageGroup(state, person, group)) {
    return deny(401, { error: 'group_admin_required', message: 'Group admin or circle moderator required.' });
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
  return completeGroupForm(res, groupHref(groupId, 'settings'), 'policy-saved');
}
