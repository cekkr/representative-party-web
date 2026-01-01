import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction } from '../../../modules/circle/policy.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import {
  createGroup,
  findGroupById,
  isGroupAdmin,
  isGroupMember,
  joinGroup,
  leaveGroup,
  listGroups,
  setGroupDelegate,
} from '../../../modules/groups/groups.js';
import { createNotification } from '../../../modules/messaging/notifications.js';
import { getGroupPolicy, setGroupPolicy } from '../../../modules/groups/groupPolicy.js';
import { startElection, listElections, castElectionVote, pickWinner, closeElection } from '../../../modules/groups/groupElections.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';
import { renderIssuerPill } from '../views/shared.js';
import { resolvePersonHandle } from '../views/actorLabel.js';

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
      personHandle: resolvePersonHandle(person),
      personHash: person?.pidHash || '',
      circlePolicyNote: 'Party Circle policy governs quorum/votes; groups manage internal delegate preferences and hierarchies.',
    },
    { wantsPartial, title: 'Groups', state },
  );
  return sendHtml(res, html);
}

export async function createOrJoinGroup({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups' });
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
    const candidates = (body.candidates || '').split(',').map((v) => sanitizeText(v, 80)).filter(Boolean);
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
    const candidateHash = sanitizeText(body.candidateHash || '', 80);
    const secondChoiceHash = sanitizeText(body.secondChoiceHash || '', 80);
    const thirdChoiceHash = sanitizeText(body.thirdChoiceHash || '', 80);
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
  const group = await createGroup({ name, description, topics, creatorHash: person?.pidHash, state });
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
    return sendModuleDisabledJson({ res, moduleKey: 'groups' });
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
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
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

export async function updateGroupPolicyRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups' });
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
  await setGroupPolicy(state, { groupId, electionMode, conflictRule, categoryWeighted });
  await logTransaction(state, {
    type: 'group_policy_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { groupId, electionMode, conflictRule, categoryWeighted },
  });
  return renderGroups({ req, res, state, wantsPartial });
}

function renderGroupList(groups, person, state) {
  if (!groups.length) return '<p class="muted">No groups yet.</p>';
  return groups
    .map((group) => {
      const member = person?.pidHash ? group.members?.includes(person.pidHash) : false;
      const policy = group.policy || {};
      const delegates = (group.delegates || [])
        .map((d) => {
          const topic = escapeHtml(String(d.topic || 'general'));
          const delegate = escapeHtml(String(d.delegateHash || 'unknown'));
          const priority = Number(d.priority) || 0;
          return `<li>${topic} → ${delegate} (prio ${priority})</li>`;
        })
        .join('');
      const elections = renderElections(group.elections || [], person, state);
      const topicLabel = group.topics?.length ? escapeHtml(group.topics.join(', ')) : 'general';
      const name = escapeHtml(group.name || 'Group');
      const description = escapeHtml(group.description || '');
      const groupId = escapeHtml(group.id || '');
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">Group</span>
            ${group.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${topicLabel}</span>
          </div>
          <h3>${name}</h3>
          <p>${description}</p>
          <p class="muted small">Members: ${group.members?.length || 0}</p>
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
              <button type="submit" class="ghost">Save policy</button>
            </form>
          </details>
          <details class="note">
            <summary>Set preferred delegate</summary>
            <form class="form-inline" method="post" action="/groups/delegate" data-enhance="groups">
              <input type="hidden" name="groupId" value="${groupId}" />
              <label>Topic <input name="topic" placeholder="general" /></label>
              <label>Delegate hash <input name="delegateHash" placeholder="delegate-hash" required /></label>
              <label>Priority <input name="priority" type="number" value="0" size="4" /></label>
              <button type="submit" class="ghost">Save</button>
            </form>
          </details>
          <details class="note">
            <summary>Delegate election</summary>
            <form class="stack" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="startElection" />
              <input type="hidden" name="groupId" value="${groupId}" />
              <label class="field">
                <span>Topic</span>
                <input name="topic" placeholder="energy" />
              </label>
              <label class="field">
                <span>Candidate hashes (comma separated)</span>
                <input name="candidates" placeholder="hash1,hash2" />
              </label>
              <button class="ghost" type="submit">Start election</button>
            </form>
            ${elections}
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
      const previewPill = election.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : '';
      const issuerPill = renderIssuerPill(election);
      const topicLabel = escapeHtml(election.topic || 'general');
      const statusLabel = escapeHtml(election.status || 'open');
      const electionId = escapeHtml(election.id || '');
      const candidates = (election.candidates || []).map((c) => escapeHtml(String(c)));
      const winner = election.status === 'closed' ? pickWinner(election, state) : null;
      const winnerHash = winner?.candidateHash ? escapeHtml(winner.candidateHash) : '';
      const winnerMethod = winner?.method ? escapeHtml(winner.method) : '';
      const winnerRounds = Number.isFinite(winner?.rounds) ? winner.rounds : null;
      const winnerLabel = winnerHash
        ? `Winner: ${winnerHash}${winnerMethod ? ` (method ${winnerMethod}${winnerRounds ? `, rounds ${winnerRounds}` : ''})` : ''}`
        : '';
      const closedAt = election.closedAt ? new Date(election.closedAt).toLocaleString() : '';
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
                  .map((c) => `<option value="${c}">${c}</option>`)
                  .join('')}
              </select>
              <select name="secondChoiceHash">
                <option value="">Second choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c}">${c}</option>`)
                  .join('')}
              </select>
              <select name="thirdChoiceHash">
                <option value="">Third choice (optional)</option>
                ${candidates
                  .map((c) => `<option value="${c}">${c}</option>`)
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
