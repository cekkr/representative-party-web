import { randomUUID } from 'node:crypto';

import { POLICIES } from '../config.js';
import { getCitizen } from '../services/citizen.js';
import { evaluateDiscussionPermission, getCirclePolicyState } from '../services/policy.js';
import { persistDiscussions } from '../state/storage.js';
import { sendHtml, sendJson, sendRedirect } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';
import { renderDiscussionList } from '../views/discussionView.js';
import { renderPage } from '../views/templates.js';

export async function renderDiscussion({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const policy = getCirclePolicyState(state);
  const html = await renderPage(
    'discussion',
    {
      ledgerSize: state.uniquenessLedger.size,
      citizenHandle: citizen?.handle || 'Not verified yet',
      citizenStatus: citizen
        ? 'Posting as verified citizen bound to a blinded PID hash.'
        : 'Start the wallet flow to post with accountability.',
      discussionList: renderDiscussionList(state.discussions),
      verificationPolicy: POLICIES.requireVerification ? 'Wallet verification required to post.' : 'Open posting allowed (demo mode).',
      circlePolicy: policy.enforcement === 'strict' ? 'Circle enforcement active: verification required before posting.' : 'Circle policy observing: demo-friendly mode.',
      policyId: policy.id,
      policyVersion: policy.version,
      hashOnlyMessage: 'Hash-only ledger: only salted PID hashes are stored to link posts to accountability.',
    },
    { wantsPartial, title: 'Deliberation Sandbox' },
  );
  return sendHtml(res, html);
}

export async function postDiscussion({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const permission = evaluateDiscussionPermission(citizen);
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
  state.discussions.unshift(entry);
  await persistDiscussions(state);

  if (wantsPartial) {
    const policy = getCirclePolicyState(state);
    const html = await renderPage(
      'discussion',
      {
        ledgerSize: state.uniquenessLedger.size,
        citizenHandle: citizen?.handle || 'Not verified yet',
        citizenStatus: citizen
          ? 'Posting as verified citizen bound to a blinded PID hash.'
          : 'Start the wallet flow to post with accountability.',
        discussionList: renderDiscussionList(state.discussions),
        verificationPolicy: POLICIES.requireVerification
          ? 'Wallet verification required to post.'
          : 'Open posting allowed (demo mode).',
        circlePolicy:
          policy.enforcement === 'strict' ? 'Circle enforcement active: verification required before posting.' : 'Circle policy observing: demo-friendly mode.',
        policyId: policy.id,
        policyVersion: policy.version,
        hashOnlyMessage: 'Hash-only ledger: only salted PID hashes are stored to link posts to accountability.',
      },
      { wantsPartial, title: 'Deliberation Sandbox' },
    );
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/discussion');
}
