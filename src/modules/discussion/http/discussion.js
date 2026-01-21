import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { evaluateAction, getCirclePolicyState } from '../../circle/policy.js';
import { getTopicConfig } from '../../topics/topicGardenerClient.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey, storeTopicPreferences } from '../../topics/preferences.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { logTransaction } from '../../transactions/registry.js';
import { persistDiscussions, persistProfileAttributes } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { recordRateLimit } from '../../ops/metrics.js';
import { renderDiscussionList } from '../../../interfaces/http/views/discussionView.js';
import { getActorLabels, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { buildTopicOptions, renderTopicDatalist, renderTopicFilterOptions } from '../../../interfaces/http/views/topicHelpers.js';
import { renderCalloutRow } from '../../../interfaces/http/views/shared.js';

export async function renderDiscussion({ req, res, state, wantsPartial, url }) {
  const person = getPerson(req, state);
  const html = await renderDiscussionShell({ state, person, wantsPartial, url });
  return sendHtml(res, html);
}

export async function postDiscussion({ req, res, state, wantsPartial, url }) {
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const intent = body.intent || 'post';
  if (intent === 'topic-preferences') {
    if (!person) {
      return sendJson(res, 401, { error: 'verification_required', message: 'Login required to save topic preferences.' });
    }
    const permission = evaluateAction(state, person, 'post');
    if (!permission.allowed) {
      return sendJson(res, 401, { error: permission.reason, message: permission.message });
    }
    storeTopicPreferences(state, person, body.topics || '');
    await persistProfileAttributes(state);
    if (wantsPartial) {
      const html = await renderDiscussionShell({ state, person, wantsPartial, url });
      return sendHtml(res, html);
    }
    return sendRedirect(res, '/discussion');
  }

  const permission = evaluateAction(state, person, 'post');
  if (!permission.allowed) {
    return sendJson(res, 401, { error: permission.reason, message: permission.message });
  }
  const actorKey = resolveRateLimitActor({ person, req });
  const rateLimit = consumeRateLimit(state, { key: 'discussion_post', actorKey });
  if (!rateLimit.allowed) {
    recordRateLimit(state, 'discussion_post');
    return sendRateLimit(res, {
      action: 'discussion_post',
      message: rateLimit.message,
      retryAfter: rateLimit.retryAfter,
      limit: rateLimit.limit,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.resetAt,
    });
  }

  const topicInput = sanitizeText(body.topic || 'General', 80);
  const topicResult = await ensureTopicPath(state, topicInput, { source: 'discussion' });
  const topic = topicResult.topic?.label || topicInput || 'general';
  const topicPath = topicResult.path?.length ? topicResult.path.map((entry) => entry.label) : [];
  const stance = sanitizeText(body.stance || 'neutral', 40);
  const content = sanitizeText(body.content || '', 800);
  const evidenceLinks = parseEvidenceLinks(body.evidenceLinks || '');
  const policy = getCirclePolicyState(state);

  if (!content) {
    return sendJson(res, 400, { error: 'missing_content' });
  }

  const entry = {
    id: randomUUID(),
    topic,
    topicId: topicResult.topic?.id || null,
    topicPath,
    stance,
    content,
    evidenceLinks,
    authorHash: person?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
    policyId: policy.id,
    policyVersion: policy.version,
  };
  const stamped = stampLocalEntry(state, entry);
  state.discussions.unshift(stamped);
  await persistDiscussions(state);
  await logTransaction(state, {
    type: 'discussion_post',
    actorHash: person?.pidHash || 'anonymous',
    payload: { discussionId: entry.id, topic, stance, evidenceCount: evidenceLinks.length },
  });

  if (wantsPartial) {
    const html = await renderDiscussionShell({ state, person, wantsPartial, url });
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/discussion');
}

async function renderDiscussionShell({ state, person, wantsPartial, url }) {
  const policy = getCirclePolicyState(state);
  const permission = evaluateAction(state, person, 'post');
  const actorLabels = getActorLabels(state);
  const postingStatus = permission.allowed ? 'Posting allowed.' : 'Posting blocked.';
  const postingReason = permission.allowed ? '' : permission.message || permission.reason || '';
  const postingReasonLine = renderCalloutRow(postingReason);
  const composeOpen = url?.searchParams?.get('compose') ? 'open' : '';

  const baseEntries = filterVisibleEntries(state.discussions, state, (entry) => {
    if (entry.petitionId) return false;
    if (entry.parentId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return false;
    return true;
  });
  const topicFilterKey = normalizeTopicFilter(url?.searchParams?.get('topic') || '');
  const topicConfig = getTopicConfig(state);
  const topicPreferences = getTopicPreferences(state, person);
  const topicOptions = buildTopicOptions({
    anchors: topicConfig.anchors,
    pinned: topicConfig.pinned,
    preferences: topicPreferences,
    entries: baseEntries,
  });
  const discussionEntries =
    topicFilterKey === 'all'
      ? baseEntries
      : baseEntries.filter((entry) => normalizeTopicKey(entry.topic) === topicFilterKey);

  return renderPage(
    'discussion',
    {
      ledgerSize: state.uniquenessLedger.size,
      person,
      personHandle: resolvePersonHandle(person),
      personStatus: person
        ? `Posting as verified ${actorLabels.actorLabel} with a blinded PID hash for accountability.`
        : 'Verify your wallet to post with accountability.',
      discussionList: renderDiscussionList(discussionEntries, state),
      verificationPolicy: policy.requireVerification
        ? 'Wallet verification required to post.'
        : 'Wallet verification optional; posting is still tied to your session.',
      circlePolicy: policy.enforcement === 'strict'
        ? 'Circle enforcement active: only verified people can post.'
        : 'Circle enforcement observing: verified and unverified posting allowed.',
      policyId: policy.id,
      policyVersion: policy.version,
      circleName: policy.circleName,
      hashOnlyMessage: `Hash-only ledger: only salted PID hashes are stored to link posts to ${actorLabels.actorLabelPlural} for accountability.`,
      postingStatus,
      postingReasonLine,
      roleLabel: person?.role || 'guest',
      topicFilterOptions: renderTopicFilterOptions(topicOptions, topicFilterKey),
      topicFilterSelectedAll: topicFilterKey === 'all' ? 'selected' : '',
      topicDatalist: renderTopicDatalist(topicOptions),
      topicPreferencesValue: formatTopicList(topicPreferences),
      topicAnchors: formatTopicList(topicConfig.anchors || []),
      topicPinned: formatTopicList(topicConfig.pinned || []) || 'none',
      composeOpen,
    },
    { wantsPartial, title: 'Discussion', state },
  );
}

function normalizeTopicFilter(value) {
  const normalized = normalizeTopicKey(value);
  if (!normalized || normalized === 'all') return 'all';
  return normalized;
}
