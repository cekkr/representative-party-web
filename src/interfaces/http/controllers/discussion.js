import { randomUUID } from 'node:crypto';

import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction, getCirclePolicyState } from '../../../modules/circle/policy.js';
import { persistDiscussions } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { renderDiscussionList } from '../views/discussionView.js';
import { renderPage } from '../views/templates.js';
import { deriveStatusMeta, renderStatusStrip } from '../views/status.js';

export async function renderDiscussion({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const html = await renderDiscussionShell({ state, person, wantsPartial });
  return sendHtml(res, html);
}

export async function postDiscussion({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
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
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);

  if (wantsPartial) {
    const html = await renderDiscussionShell({ state, person, wantsPartial });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/discussion');
}

async function renderDiscussionShell({ state, person, wantsPartial }) {
  const policy = getCirclePolicyState(state);
  const permission = evaluateAction(state, person, 'post');
  const postingStatus = permission.allowed
    ? `Posting allowed as ${permission.role}.`
    : `Posting blocked: ${permission.message || permission.reason}`;

  const discussionEntries = filterVisibleEntries(state.discussions, state).filter((entry) => {
    if (entry.petitionId) return false;
    if (entry.parentId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return false;
    return true;
  });

  return renderPage(
    'discussion',
    {
      ledgerSize: state.uniquenessLedger.size,
      personHandle: person?.handle || 'Not verified yet',
      personStatus: person
        ? 'Posting as verified person bound to a blinded PID hash.'
        : 'Start the wallet flow to post with accountability.',
      discussionList: renderDiscussionList(discussionEntries),
      verificationPolicy: policy.requireVerification ? 'Wallet verification required to post.' : 'Open posting allowed (demo mode).',
      circlePolicy: policy.enforcement === 'strict' ? 'Circle enforcement active: verification required before posting.' : 'Circle policy observing: demo-friendly mode.',
      policyId: policy.id,
      policyVersion: policy.version,
      circleName: policy.circleName,
      hashOnlyMessage: 'Hash-only ledger: only salted PID hashes are stored to link posts to accountability.',
      postingStatus,
      postingReason: permission.message || '',
      roleLabel: person?.role || 'guest',
      statusStrip: renderStatusStrip(deriveStatusMeta(state)),
    },
    { wantsPartial, title: 'Deliberation Sandbox', state },
  );
}
