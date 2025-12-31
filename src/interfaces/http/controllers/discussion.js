import { randomUUID } from 'node:crypto';

import { getPerson } from '../../../modules/identity/person.js';
import { evaluateAction, getCirclePolicyState } from '../../../modules/circle/policy.js';
import { getTopicConfig } from '../../../modules/topics/topicGardenerClient.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey, storeTopicPreferences } from '../../../modules/topics/preferences.js';
import { ensureTopicPath } from '../../../modules/topics/registry.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { persistDiscussions, persistProfileAttributes } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../../modules/federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../../modules/identity/rateLimit.js';
import { renderDiscussionList } from '../views/discussionView.js';
import { getActorLabels } from '../views/actorLabel.js';
import { renderPage } from '../views/templates.js';
import { deriveStatusMeta, renderStatusStrip } from '../views/status.js';

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
    payload: { discussionId: entry.id, topic, stance },
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
  const postingStatus = permission.allowed
    ? `Posting allowed as ${permission.role}.`
    : `Posting blocked: ${permission.message || permission.reason}`;

  const baseEntries = filterVisibleEntries(state.discussions, state).filter((entry) => {
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
      personHandle: person?.handle || 'Not verified yet',
      personStatus: person
        ? `Posting as verified ${actorLabels.actorLabel} bound to a blinded PID hash.`
        : 'Start the wallet flow to post with accountability.',
      discussionList: renderDiscussionList(discussionEntries, state),
      verificationPolicy: policy.requireVerification ? 'Wallet verification required to post.' : 'Open posting allowed (demo mode).',
      circlePolicy: policy.enforcement === 'strict' ? 'Circle enforcement active: verification required before posting.' : 'Circle policy observing: demo-friendly mode.',
      policyId: policy.id,
      policyVersion: policy.version,
      circleName: policy.circleName,
      hashOnlyMessage: `Hash-only ledger: only salted PID hashes are stored to link posts to ${actorLabels.actorLabelPlural} for accountability.`,
      postingStatus,
      postingReason: permission.message || '',
      roleLabel: person?.role || 'guest',
      topicFilterOptions: renderTopicFilterOptions(topicOptions, topicFilterKey),
      topicFilterSelectedAll: topicFilterKey === 'all' ? 'selected' : '',
      topicDatalist: renderTopicDatalist(topicOptions),
      topicPreferencesValue: formatTopicList(topicPreferences),
      topicAnchors: formatTopicList(topicConfig.anchors || []),
      topicPinned: formatTopicList(topicConfig.pinned || []) || 'none',
      statusStrip: renderStatusStrip(deriveStatusMeta(state)),
    },
    { wantsPartial, title: 'Deliberation Sandbox', state },
  );
}

function normalizeTopicFilter(value) {
  const normalized = normalizeTopicKey(value);
  if (!normalized || normalized === 'all') return 'all';
  return normalized;
}

function buildTopicOptions({ anchors = [], pinned = [], preferences = [], entries = [] } = {}, { limit = 18 } = {}) {
  const topics = [];
  const seen = new Set();
  const pushTopic = (value) => {
    const label = sanitizeText(String(value || '').trim(), 48);
    if (!label) return;
    const key = normalizeTopicKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    topics.push(label);
  };

  for (const topic of preferences || []) pushTopic(topic);
  for (const topic of pinned || []) pushTopic(topic);
  for (const topic of anchors || []) pushTopic(topic);
  for (const entry of entries || []) pushTopic(entry.topic);

  return topics.slice(0, limit);
}

function renderTopicFilterOptions(topics = [], selectedKey = '') {
  return (topics || [])
    .map((topic) => {
      const key = normalizeTopicKey(topic);
      const selected = key === selectedKey ? ' selected' : '';
      return `<option value="${escapeHtml(topic)}"${selected}>${escapeHtml(topic)}</option>`;
    })
    .join('\n');
}

function renderTopicDatalist(topics = []) {
  return (topics || []).map((topic) => `<option value="${escapeHtml(topic)}"></option>`).join('\n');
}
