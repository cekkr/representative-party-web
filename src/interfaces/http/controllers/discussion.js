import { randomUUID } from 'node:crypto';

import { getCitizen } from '../../modules/identity/citizen.js';
import { evaluateAction, getCirclePolicyState } from '../../modules/circle/policy.js';
import { persistDiscussions } from '../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRedirect } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { renderDiscussionList } from '../views/discussionView.js';
import { renderPage } from '../views/templates.js';

export async function renderDiscussion({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const html = await renderDiscussionShell({ state, citizen, wantsPartial });
  return sendHtml(res, html);
}

export async function postDiscussion({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateAction(state, citizen, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message });
  }

  const body = await readRequestBody(req);
  const topic = sanitizeText(body.topic || 'General', 80);
  const stance = sanitizeText(body.stance || 'neutral', 40);
  const content = sanitizeText(body.content || '', 800);

  if (!content) {
    return sendJson(res, 400, { error: 'missing_content' });
  }

  const entry = {
    id: randomUUID(),
    topic,
    stance,
    content,
    authorHash: citizen?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);

  if (wantsPartial) {
    const html = await renderDiscussionShell({ state, citizen, wantsPartial });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/discussion');
}

async function renderDiscussionShell({ state, citizen, wantsPartial }) {
  const policy = getCirclePolicyState(state);
  const permission = evaluateAction(state, citizen, 'post');
  const postingStatus = permission.allowed
    ? `Posting allowed as ${permission.role}.`
    : `Posting blocked: ${permission.message || permission.reason}`;

  return renderPage(
    'discussion',
    {
      ledgerSize: state.uniquenessLedger.size,
      citizenHandle: citizen?.handle || 'Not verified yet',
      citizenStatus: citizen
        ? 'Posting as verified citizen bound to a blinded PID hash.'
        : 'Start the wallet flow to post with accountability.',
      discussionList: renderDiscussionList(filterVisibleEntries(state.discussions, state)),
      verificationPolicy: policy.requireVerification ? 'Wallet verification required to post.' : 'Open posting allowed (demo mode).',
      circlePolicy: policy.enforcement === 'strict' ? 'Circle enforcement active: verification required before posting.' : 'Circle policy observing: demo-friendly mode.',
      policyId: policy.id,
      policyVersion: policy.version,
      circleName: policy.circleName,
      hashOnlyMessage: 'Hash-only ledger: only salted PID hashes are stored to link posts to accountability.',
      postingStatus,
      postingReason: permission.message || '',
      roleLabel: citizen?.role || 'guest',
    },
    { wantsPartial, title: 'Deliberation Sandbox' },
  );
}
