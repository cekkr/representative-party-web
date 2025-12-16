import { getCitizen } from '../services/citizen.js';
import { evaluateAction } from '../services/policy.js';
import { createGroup, joinGroup, leaveGroup, listGroups, setGroupDelegate } from '../services/groups.js';
import { createNotification } from '../services/notifications.js';
import { sendHtml, sendJson } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';
import { renderPage } from '../views/templates.js';

export async function renderGroups({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const groups = listGroups(state);
  const html = await renderPage(
    'groups',
    {
      groups: renderGroupList(groups, citizen),
      citizenHandle: citizen?.handle || 'Guest',
      citizenHash: citizen?.pidHash || '',
      circlePolicyNote: 'Party Circle policy governs quorum/votes; groups manage internal delegate preferences and hierarchies.',
    },
    { wantsPartial, title: 'Groups' },
  );
  return sendHtml(res, html);
}

export async function createOrJoinGroup({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const body = await readRequestBody(req);
  const action = body.action || 'create';

  if (action === 'join') {
    const groupId = sanitizeText(body.groupId || '', 80);
    await joinGroup({ groupId, citizen, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  if (action === 'leave') {
    const groupId = sanitizeText(body.groupId || '', 80);
    await leaveGroup({ groupId, citizen, state });
    return renderGroups({ req, res, state, wantsPartial });
  }

  const permission = evaluateAction(state, citizen, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message || 'Not allowed to create group.' });
  }

  const name = sanitizeText(body.name || '', 120);
  const description = sanitizeText(body.description || '', 400);
  const topics = (body.topics || '').split(',').map((t) => sanitizeText(t, 64)).filter(Boolean);
  const group = await createGroup({ name, description, topics, creatorHash: citizen?.pidHash, state });
  await createNotification(state, {
    type: 'group_created',
    recipientHash: citizen?.pidHash || 'broadcast',
    message: `Group "${group.name}" created.`,
  });
  return renderGroups({ req, res, state, wantsPartial });
}

export async function setGroupDelegateRoute({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'moderate');
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
    recipientHash: citizen?.pidHash || 'broadcast',
    message: `Updated delegate for topic "${topic}" in group.`,
  });
  return renderGroups({ req, res, state, wantsPartial });
}

function renderGroupList(groups, citizen) {
  if (!groups.length) return '<p class="muted">No groups yet.</p>';
  return groups
    .map((group) => {
      const member = citizen?.pidHash ? group.members?.includes(citizen.pidHash) : false;
      const delegates = (group.delegates || [])
        .map((d) => `<li>${d.topic} → ${d.delegateHash} (prio ${d.priority})</li>`)
        .join('');
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">Group</span>
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
            <summary>Set preferred delegate</summary>
            <form class="form-inline" method="post" action="/groups/delegate" data-enhance="groups">
              <input type="hidden" name="groupId" value="${group.id}" />
              <label>Topic <input name="topic" placeholder="general" /></label>
              <label>Delegate hash <input name="delegateHash" placeholder="delegate-hash" required /></label>
              <label>Priority <input name="priority" type="number" value="0" size="4" /></label>
              <button type="submit" class="ghost">Save</button>
            </form>
          </details>
        </article>
      `;
    })
    .join('\n');
}
