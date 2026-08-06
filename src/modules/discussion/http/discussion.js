import { randomUUID } from 'node:crypto';

import { getPerson } from '../../identity/person.js';
import { evaluateAction, getCirclePolicyState } from '../../circle/policy.js';
import { getTopicConfig } from '../../topics/topicGardenerClient.js';
import { formatTopicList, getTopicPreferences, normalizeTopicKey, storeTopicPreferences } from '../../topics/preferences.js';
import { ensureTopicPath } from '../../topics/registry.js';
import { logTransaction } from '../../transactions/registry.js';
import { createNotification } from '../../messaging/notifications.js';
import { persistDiscussions, persistProfileAttributes } from '../../../infra/persistence/storage.js';
import { filterVisibleEntries, stampLocalEntry } from '../../federation/replication.js';
import { sendHtml, sendJson, sendRateLimit, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { escapeHtml, parseEvidenceLinks, sanitizeText } from '../../../shared/utils/text.js';
import { consumeRateLimit, resolveRateLimitActor } from '../../identity/rateLimit.js';
import { recordRateLimit } from '../../ops/metrics.js';
import { renderDiscussionList } from '../../../interfaces/http/views/discussionView.js';
import { getActorLabels, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { renderPager } from '../../../interfaces/http/views/shared.js';
import { paginate, parsePage } from '../../../shared/utils/pagination.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { buildTopicOptions, renderTopicDatalist, renderTopicFilterOptions } from '../../../interfaces/http/views/topicHelpers.js';
import { renderContextPanel } from '../../../interfaces/http/views/contextPanel.js';
import {
  listPostableGroupLanes,
  listReadableGroupLanes,
  matchesGroupScope,
  readGroupScope,
  resolveGroupScope,
} from '../../groups/groupScope.js';
import {
  applyPromotion,
  applyPromotionDecision,
  applyPromotionRequest,
  evaluatePromotion,
  evaluatePromotionDecision,
  evaluatePromotionRequest,
} from '../../groups/promotion.js';

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

  if (intent === 'promote' || intent === 'promote-request' || intent === 'promote-decide') {
    return promoteDiscussion({ req, res, state, wantsPartial, url, body, person, intent });
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

  // An entry may be scoped to a group's internal lane. Membership and the lane toggle are
  // both checked here, so a crafted POST cannot plant an entry in a group's lane.
  const requestedGroup = readGroupScope(sanitizeText(body.groupId || '', 80));
  const scope = resolveGroupScope(state, person, requestedGroup, { lane: 'discussion' });
  if (!scope.ok) {
    return sendJson(res, scope.error === 'group_not_found' ? 404 : 403, {
      error: scope.error,
      message: scope.message,
    });
  }
  if (scope.scoped && !listPostableGroupLanes(state, person, 'discussion').some((g) => g.id === scope.groupId)) {
    return sendJson(res, 403, {
      error: 'group_membership_required',
      message: 'Join the group to post in its internal discussion.',
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
    groupId: scope.groupId,
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
    payload: { discussionId: entry.id, topic, stance, evidenceCount: evidenceLinks.length, groupId: scope.groupId },
  });

  if (wantsPartial) {
    const html = await renderDiscussionShell({ state, person, wantsPartial, url, scopeOverride: scope.groupId });
    return sendHtml(res, html);
  }

  return sendRedirect(res, scope.groupId ? `/discussion?group=${encodeURIComponent(scope.groupId)}` : '/discussion');
}

// Move a group's discussion one level up: to the parent group, or to the Circle when the
// group is already top level.
async function promoteDiscussion({ req, res, state, wantsPartial, url, body, person, intent = 'promote' }) {
  const discussionId = sanitizeText(body.discussionId || '', 120);
  const entry = (state.discussions || []).find((item) => item.id === discussionId);

  if (intent === 'promote-request') {
    const request = applyPromotionRequest(state, person, {
      kind: 'discussion',
      entry,
      note: sanitizeText(body.note || '', 240),
    });
    if (!request.ok) {
      return sendJson(res, request.error === 'entry_not_found' ? 404 : 403, {
        error: request.error,
        message: request.message,
      });
    }
    await persistDiscussions(state);
    await logTransaction(state, {
      type: 'discussion_promotion_requested',
      actorHash: person?.pidHash || 'anonymous',
      payload: { discussionId, groupId: entry.groupId, targetGroupId: request.targetId },
    });
    // Everyone who can decide gets told, so a request does not sit unseen.
    for (const hash of listGroupDeciders(state, request.group)) {
      await createNotification(state, {
        type: 'promotion_requested',
        recipientHash: hash,
        message: `A member asked to move a discussion up to ${request.targetLabel}.`,
      });
    }
    return finishDiscussionPromotion({ req, res, state, wantsPartial, url, person, groupId: entry.groupId });
  }

  if (intent === 'promote-decide') {
    const verdict = sanitizeText(body.decision || 'decline', 16);
    const result = applyPromotionDecision(state, person, {
      kind: 'discussion',
      entry,
      decision: verdict,
      reason: sanitizeText(body.reason || '', 240),
    });
    if (!result.ok) {
      return sendJson(res, result.error === 'entry_not_found' ? 404 : 403, {
        error: result.error,
        message: result.message,
      });
    }
    await persistDiscussions(state);
    await logTransaction(state, {
      type: result.approved ? 'discussion_promoted' : 'discussion_promotion_declined',
      actorHash: person?.pidHash || 'anonymous',
      payload: {
        discussionId,
        fromGroupId: result.fromGroupId ?? null,
        toGroupId: result.toGroupId ?? null,
        requestedByHash: result.request?.byHash || null,
      },
    });
    if (result.request?.byHash) {
      await createNotification(state, {
        type: result.approved ? 'promotion_approved' : 'promotion_declined',
        recipientHash: result.request.byHash,
        message: result.approved
          ? `Your request to move a discussion up to ${result.request.targetLabel} was approved.`
          : `Your request to move a discussion up was declined${result.request.reason ? `: ${result.request.reason}` : '.'}`,
      });
    }
    return finishDiscussionPromotion({
      req,
      res,
      state,
      wantsPartial,
      url,
      person,
      groupId: result.approved ? result.toGroupId : entry.groupId,
    });
  }

  const decision = applyPromotion(state, person, { kind: 'discussion', entry });
  if (!decision.ok) {
    return sendJson(res, decision.error === 'entry_not_found' ? 404 : 403, {
      error: decision.error,
      message: decision.message,
    });
  }
  await persistDiscussions(state);
  await logTransaction(state, {
    type: 'discussion_promoted',
    actorHash: person?.pidHash || 'anonymous',
    payload: { discussionId, fromGroupId: decision.fromGroupId, toGroupId: decision.toGroupId },
  });
  return finishDiscussionPromotion({ req, res, state, wantsPartial, url, person, groupId: decision.toGroupId });
}

async function finishDiscussionPromotion({ res, state, wantsPartial, url, person, groupId }) {
  if (wantsPartial) {
    const html = await renderDiscussionShell({ state, person, wantsPartial, url, scopeOverride: groupId ?? null });
    return sendHtml(res, html);
  }
  return sendRedirect(res, groupId ? `/discussion?group=${encodeURIComponent(groupId)}` : '/discussion');
}

// Group admins and lane moderators — the people who may decide a request.
function listGroupDeciders(state, group) {
  return (group?.roles || [])
    .filter((entry) => entry.role === 'admin' || entry.role === 'laneModerator')
    .map((entry) => entry.hash)
    .filter(Boolean);
}

async function renderDiscussionShell({ state, person, wantsPartial, url, scopeOverride }) {
  const policy = getCirclePolicyState(state);
  const permission = evaluateAction(state, person, 'post');
  const actorLabels = getActorLabels(state);
  const composeOpen = url?.searchParams?.get('compose') ? 'open' : '';

  const requestedGroup = scopeOverride !== undefined ? scopeOverride : readGroupScope(url?.searchParams);
  const scope = resolveGroupScope(state, person, requestedGroup, { lane: 'discussion' });
  // A refused scope falls back to the Circle feed with the reason stated, rather than
  // rendering an empty list that looks like the group simply has nothing to say.
  const activeGroupId = scope.ok ? scope.groupId : null;
  const scopeNotice = scope.ok ? '' : scope.message;

  const baseEntries = filterVisibleEntries(state.discussions, state, (entry) => {
    if (entry.petitionId) return false;
    if (entry.parentId) return false;
    if (entry.stance === 'article' || entry.stance === 'comment') return false;
    return matchesGroupScope(entry, activeGroupId);
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

  const pageInfo = paginate(discussionEntries, { page: parsePage(url?.searchParams?.get('page')) });
  const discussionPager = renderPager(pageInfo, {
    baseHref: '/discussion',
    query: { topic: topicFilterKey === 'all' ? '' : topicFilterKey, group: activeGroupId || '' },
    label: 'posts',
  });

  return renderPage(
    'discussion',
    {
      person,
      personHandle: resolvePersonHandle(person),
      discussionContext: renderContextPanel({
        gates: [
          {
            label: 'Post to discussion',
            status: permission.allowed ? 'Allowed' : 'Blocked',
            allowed: permission.allowed,
            reason: permission.allowed ? '' : permission.message || permission.reason || '',
          },
        ],
        facts: [
          { term: 'Role', value: person?.role || 'guest' },
          { term: 'Handle', value: resolvePersonHandle(person) || 'Not signed in' },
          {
            term: 'Circle',
            value: policy.enforcement === 'strict'
              ? 'Strict — verified only'
              : 'Observing — verification recommended',
          },
          { term: 'Ledger', value: `${state.uniquenessLedger.size} verified` },
          { term: 'Policy', value: `${policy.id} v${policy.version}` },
        ],
        guidance: [
          person
            ? `Posts inherit your blinded PID hash for accountability; only salted hashes link posts to ${actorLabels.actorLabelPlural}.`
            : 'Verify your wallet to post with accountability.',
          'Use discussion for exploration; move decisions to proposals and votes when they are needed.',
        ],
      }),
      discussionList: renderDiscussionList(pageInfo.items, state, {
        groupId: activeGroupId,
        promotable: (entry) => evaluatePromotion(state, person, { kind: 'discussion', entry }),
        requestable: (entry) => evaluatePromotionRequest(state, person, { kind: 'discussion', entry }),
        decidable: (entry) => evaluatePromotionDecision(state, person, { kind: 'discussion', entry }),
      }),
      discussionPager,
      discussionScopeTabs: renderScopeTabs({ state, person, activeGroupId, lane: 'discussion', baseHref: '/discussion' }),
      discussionScopeNotice: scopeNotice ? `<p class="muted small">${escapeHtml(scopeNotice)}</p>` : '',
      discussionScopeValue: escapeHtml(activeGroupId || ''),
      discussionGroupPicker: renderGroupLanePicker(state, person, 'discussion', activeGroupId),
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

// Lane tabs: the Circle feed plus every group lane this member can read. Rendered as links
// so the scope survives without JavaScript.
function renderScopeTabs({ state, person, activeGroupId, lane, baseHref }) {
  const groups = listReadableGroupLanes(state, person, lane);
  if (!groups.length) return '';
  const tab = (href, label, active) =>
    `<a class="pill ${active ? '' : 'ghost'}" href="${escapeHtml(href)}" data-partial>${escapeHtml(label)}</a>`;
  const tabs = [tab(baseHref, 'Whole Circle', !activeGroupId)];
  for (const group of groups) {
    tabs.push(
      tab(`${baseHref}?group=${encodeURIComponent(group.id)}`, group.name || 'Group', activeGroupId === group.id),
    );
  }
  return `<div class="discussion__meta">${tabs.join('')}</div>`;
}

// Only rendered when the member actually belongs to a group with an open lane — otherwise
// the compose form would show a destination picker with exactly one destination.
function renderGroupLanePicker(state, person, lane, activeGroupId) {
  const groups = listPostableGroupLanes(state, person, lane);
  if (!groups.length) return '';
  const options = groups
    .map(
      (group) =>
        `<option value="${escapeHtml(group.id)}" ${activeGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.name || 'Group')}</option>`,
    )
    .join('');
  return `
    <label class="field">
      <span>Post to</span>
      <select name="groupId">
        <option value="" ${activeGroupId ? '' : 'selected'}>Whole Circle</option>
        ${options}
      </select>
    </label>
  `;
}

function normalizeTopicFilter(value) {
  const normalized = normalizeTopicKey(value);
  if (!normalized || normalized === 'all') return 'all';
  return normalized;
}
