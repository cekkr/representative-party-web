import { getPerson } from '../../modules/identity/person.js';
import { evaluateAction } from '../../modules/circle/policy.js';
import { isModuleEnabled } from '../../modules/circle/modules.js';
import { createGroup, joinGroup, leaveGroup, listGroups, setGroupDelegate } from '../../modules/groups/groups.js';
import { createNotification } from '../../modules/messaging/notifications.js';
import { getGroupPolicy, setGroupPolicy } from '../../modules/groups/groupPolicy.js';
import { startElection, listElections, castElectionVote, pickWinner, closeElection } from '../../modules/groups/groupElections.js';
import { sendHtml, sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { renderModuleDisabled, sendModuleDisabledJson } from '../views/moduleGate.js';

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
      groups: renderGroupList(groups, person),
      personHandle: person?.handle || 'Guest',
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
    const groupId = sanitizeText(body.groupId || '', 80);
    await joinGroup({ groupId, person, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'leave') {
    const groupId = sanitizeText(body.groupId || '', 80);
    await leaveGroup({ groupId, person, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'startElection') {
    const permission = evaluateAction(state, person, 'moderate');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to start election.' });
    }
    const groupId = sanitizeText(body.groupId || '', 80);
    const topic = sanitizeText(body.topic || 'general', 64);
    const candidates = (body.candidates || '').split(',').map((v) => sanitizeText(v, 80)).filter(Boolean);
    await startElection({ groupId, topic, candidates, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'voteElection') {
    const electionId = sanitizeText(body.electionId || '', 80);
    const candidateHash = sanitizeText(body.candidateHash || '', 80);
    const secondChoiceHash = sanitizeText(body.secondChoiceHash || '', 80);
    const thirdChoiceHash = sanitizeText(body.thirdChoiceHash || '', 80);
    await castElectionVote({ electionId, voterHash: person?.pidHash, candidateHash, secondChoiceHash, thirdChoiceHash, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'closeElection') {
    const permission = evaluateAction(state, person, 'moderate');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to close election.' });
    }
    const electionId = sanitizeText(body.electionId || '', 80);
    const election = await closeElection({ electionId, state });
    if (election) {
      const winner = pickWinner(election, state);
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
  return renderGroups({ req, res, state, wantsPartial });
}

export async function setGroupDelegateRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to set delegates.' });
  }
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
  const priority = Number(body.priority || 0);
  await setGroupDelegate({ groupId, topic, delegateHash, priority, provider: sanitizeText(body.provider || 'local', 64), state });
  await createNotification(state, {
    type: 'group_delegate',
    recipientHash: person?.pidHash || 'broadcast',
    message: `Updated delegate for topic "${topic}" in group.`,
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function updateGroupPolicyRoute({ req, res, state, wantsPartial }) {
  if (!isModuleEnabled(state, 'groups')) {
    return sendModuleDisabledJson({ res, moduleKey: 'groups' });
  }
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'moderate');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to set policies.' });
  }
  const body = await readRequestBody(req);
  const groupId = sanitizeText(body.groupId || '', 80);
  const electionMode = sanitizeText(body.electionMode || 'priority', 32);
  const conflictRule = sanitizeText(body.conflictRule || 'highest_priority', 32);
  const categoryWeighted = Boolean(body.categoryWeighted);
  await setGroupPolicy(state, { groupId, electionMode, conflictRule, categoryWeighted });
  return renderGroups({ req, res, state, wantsPartial });
}

function renderGroupList(groups, person) {
  if (!groups.length) return '<p class="muted">No groups yet.</p>';
  return groups
    .map((group) => {
      const member = person?.pidHash ? group.members?.includes(person.pidHash) : false;
      const policy = group.policy || {};
      const delegates = (group.delegates || [])
        .map((d) => `<li>${d.topic} → ${d.delegateHash} (prio ${d.priority})</li>`)
        .join('');
      const elections = renderElections(group.elections || [], person);
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">Group</span>
            ${group.validationStatus === 'preview' ? '<span class="pill warning">Preview</span>' : ''}
            <span class="muted small">${group.topics?.join(', ') || 'general'}</span>
          </div>
          <h3>${group.name}</h3>
          <p>${group.description}</p>
          <p class="muted small">Members: ${group.members?.length || 0}</p>
          <div class="muted small">Delegates:<ul>${delegates || '<li>None</li>'}</ul></div>
          <form class="form-inline" method="post" action="/groups" data-enhance="groups">
            <input type="hidden" name="groupId" value="${group.id}" />
            <input type="hidden" name="action" value="${member ? 'leave' : 'join'}" />
            <button type="submit" class="ghost">${member ? 'Leave' : 'Join'}</button>
          </form>
          <details class="note">
            <summary>Group policy</summary>
            <form class="form-inline" method="post" action="/groups/policy" data-enhance="groups">
              <input type="hidden" name="groupId" value="${group.id}" />
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
              <input type="hidden" name="groupId" value="${group.id}" />
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
              <input type="hidden" name="groupId" value="${group.id}" />
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

function renderElections(elections, person) {
  if (!elections.length) return '<p class="muted small">No elections.</p>';
  return elections
    .map((election) => {
      const tally = election.votes || [];
      return `
        <div class="muted small">
          <p>Election ${election.topic} · Status: ${election.status}</p>
          ${
            election.status === 'open'
              ? `
            <form class="form-inline" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="voteElection" />
              <input type="hidden" name="electionId" value="${election.id}" />
              <select name="candidateHash">
                ${election.candidates
                  .map((c) => `<option value="${c}">${c}</option>`)
                  .join('')}
              </select>
              <select name="secondChoiceHash">
                <option value="">Second choice (optional)</option>
                ${election.candidates
                  .map((c) => `<option value="${c}">${c}</option>`)
                  .join('')}
              </select>
              <select name="thirdChoiceHash">
                <option value="">Third choice (optional)</option>
                ${election.candidates
                  .map((c) => `<option value="${c}">${c}</option>`)
                  .join('')}
              </select>
              <button type="submit" class="ghost">Vote</button>
            </form>
            <form class="form-inline" method="post" action="/groups" data-enhance="groups">
              <input type="hidden" name="action" value="closeElection" />
              <input type="hidden" name="electionId" value="${election.id}" />
              <button type="submit" class="ghost">Close and pick winner</button>
            </form>
          `
              : ''
          }
          <p>Votes: ${tally.length}</p>
        </div>
      `;
    })
    .join('\n');
}
