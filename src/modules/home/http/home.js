import { proposalHref } from '../../petitions/proposalLinks.js';
import { getPerson } from '../../identity/person.js';
import { canAdministerProvider } from '../../identity/privileges.js';
import { evaluateAction, getCirclePolicyState, getEffectivePolicy } from '../../circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { matchesGroupScope } from '../../groups/groupScope.js';
import { forumThreadHref, isForumThread } from '../../forum/threads.js';
import {
  countVisibleEntries,
  describeProfile,
  filterVisibleEntries,
  getReplicationProfile,
  isGossipEnabled,
} from '../../federation/replication.js';
import { buildFeed } from '../../social/posts.js';
import { summarizeFollows } from '../../social/followGraph.js';
import { listNotificationsForPerson } from '../../messaging/notifications.js';
import { listTransactions } from '../../transactions/registry.js';
import { sendHtml } from '../../../shared/utils/http.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { normalizeInterfaceSettings } from '../../../interfaces/http/views/interfaceSettings.js';
import { describeVerificationPolicy } from '../../../interfaces/http/views/status.js';
import { getActorLabels, resolveHandleForHash, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import {
  renderHomeAccessList,
  renderHomeList,
  renderHomePills,
  renderHomeStats,
} from '../../../interfaces/http/views/homeView.js';

const CONVERSATION_LIMIT = 5;
const GOVERNANCE_LIMIT = 4;
const FEDERATION_LIMIT = 5;

export async function renderHome({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const actorLabels = getActorLabels(state);
  const moduleSettings = resolveModuleSettings(state);
  const profile = getReplicationProfile(state);
  const socialEnabled = isModuleEnabled(state, 'social');
  const petitionsEnabled = isModuleEnabled(state, 'petitions');
  const votesEnabled = isModuleEnabled(state, 'votes');
  const delegationEnabled = isModuleEnabled(state, 'delegation');
  const groupsEnabled = isModuleEnabled(state, 'groups');
  const federationEnabled = isModuleEnabled(state, 'federation');

  const conversationEntries = listConversationEntries(state, person, { socialEnabled });
  const discussionCount = countVisibleEntries(state.discussions, state, (entry) => isDiscussionEntry(entry));
  const forumCount = countVisibleEntries(state.discussions, state, (entry) => isForumThread(entry));
  const petitionEntries = petitionsEnabled
    ? filterVisibleEntries(state.petitions || [], state, (entry) => matchesGroupScope(entry, null))
    : [];
  const publicSocialCount = filterVisibleEntries(state.socialPosts || [], state, (entry) => entry.visibility !== 'direct').length;
  const notifications = listNotificationsForPerson(state, person);
  const unreadNotifications = notifications.filter((entry) => !entry.read);

  const postGate = evaluateAction(state, person, 'post');
  const petitionGate = petitionsEnabled
    ? evaluateAction(state, person, 'petition')
    : { allowed: false, message: 'Petitions module disabled.' };
  const voteGate = votesEnabled ? evaluateAction(state, person, 'vote') : { allowed: false, message: 'Votes module disabled.' };
  const canAdminister = canAdministerProvider(person, state);
  // Audit payloads may include details of a group lane. Keep the public Home
  // summary separate from the transaction preview available to signed-in admins.
  const showAuditPreview = person?.role === 'admin' && canAdminister;
  const transactionEntries = showAuditPreview ? listTransactions(state, { limit: FEDERATION_LIMIT }) : [];
  const hiddenDiscussionSections = normalizeInterfaceSettings(person?.uiSettings).hiddenSections.discussion;

  const voteStageCount = petitionEntries.filter((entry) => normalizePetitionStage(entry?.status) === 'vote').length;
  const activePetitionCount = petitionEntries.filter((entry) => normalizePetitionStage(entry?.status) !== 'closed').length;
  const followStats = socialEnabled && person ? summarizeFollows(state, person.pidHash) : null;

  const summaryText = buildSummaryText({ person, actorLabels, postGate });
  const overviewPills = renderHomePills(
    [
      { label: `Role: ${person?.role || 'guest'}`, tone: 'plain' },
      { label: policy.enforcement === 'strict' ? 'Circle: strict' : 'Circle: observing' },
      { label: describeVerificationPolicy(policy) },
      person ? { label: `${unreadNotifications.length} unread alerts` } : null,
      !effective.initialized ? { label: 'Installation wizard pending', tone: 'warning' } : null,
    ].filter(Boolean),
  );
  const homeStats = renderHomeStats([
    {
      label: socialEnabled ? 'Social posts' : 'Forum threads',
      value: socialEnabled ? publicSocialCount : forumCount,
      detail: socialEnabled ? 'Public micro-post lane' : 'Long-form articles',
    },
    {
      label: 'Discussion',
      value: discussionCount,
      detail: 'Top-level deliberation posts',
    },
    {
      label: 'Proposals',
      value: activePetitionCount,
      detail: petitionsEnabled ? `${voteStageCount} in vote stage` : 'Governance lane disabled',
    },
    {
      label: person ? 'Alerts' : 'Peers',
      value: person ? unreadNotifications.length : policy.peersKnown,
      detail: person ? 'Unread notifications for this handle' : 'Configured providers',
    },
  ]);
  const accessList = renderHomeAccessList([
    buildAccessItem('Posting', postGate, { detail: allowGuestDetail(policy, postGate) }),
    petitionsEnabled
      ? buildAccessItem('Proposals', petitionGate)
      : { label: 'Proposals', status: 'Disabled', detail: 'Petitions module is off for this provider.' },
    votesEnabled
      ? buildAccessItem('Voting', voteGate)
      : { label: 'Voting', status: 'Disabled', detail: 'Votes module is off for this provider.' },
    person
      ? {
          label: 'Notifications',
          status: unreadNotifications.length ? `${unreadNotifications.length} unread` : 'Up to date',
          detail: 'Internal alerts and proposal comment notifications for this handle.',
          tone: unreadNotifications.length ? 'warning' : 'ok',
        }
      : {
          label: 'Notifications',
          status: 'Sign in required',
          detail: 'Alerts are tied to a verified handle.',
        },
  ]);

  const conversationSummary = buildConversationSummary({
    socialEnabled,
    discussionCount,
    forumCount,
    followStats,
    publicSocialCount,
  });
  const governanceSummary = buildGovernanceSummary({
    petitionsEnabled,
    delegationEnabled,
    groupsEnabled,
    voteStageCount,
    activePetitionCount,
    petitionGate,
  });
  const federationSummary = buildFederationSummary({
    federationEnabled,
    profile,
    policy,
    ledgerSize: state.uniquenessLedger.size,
  });

  const conversationList = renderHomeList(
    conversationEntries.map((entry) => formatConversationItem(entry)).slice(0, CONVERSATION_LIMIT),
    {
      emptyMessage: socialEnabled
        ? 'No visible posts or threads yet. Start with the social lane or open discussion.'
        : 'No public conversation yet. Open discussion or forum to begin.',
    },
  );
  const governanceList = renderHomeList(
    sortPetitionsForHome(petitionEntries).slice(0, GOVERNANCE_LIMIT).map((entry) => formatGovernanceItem(entry)),
    {
      emptyMessage: petitionsEnabled
        ? 'No proposals yet. Draft one when a discussion needs a formal decision path.'
        : 'Governance modules are disabled for this provider.',
    },
  );
  const federationList = showAuditPreview
    ? renderHomeList(transactionEntries.map((entry) => formatFederationItem(entry, state)), {
        emptyMessage: 'No recent audit events recorded yet.',
      })
    : '';

  const opsItems = buildOpsItems({
    effective,
    federationEnabled,
    canAdminister,
    transactionEntries,
    policy,
    moduleSettings,
  });
  const opsHidden = opsItems.length ? '' : 'hidden';
  const opsList = renderHomeList(opsItems, { emptyMessage: 'No operator actions pending.' });

  const html = await renderPage(
    'home',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      circleName: escapeHtml(effective.circleName),
      workspaceCreateHref: postGate.allowed && !hiddenDiscussionSections?.includes('discussion-compose')
        ? '/discussion?compose=post#discussion-compose'
        : '',
      summaryText: escapeHtml(summaryText),
      overviewPills,
      overviewActions: buildOverviewActions({ person, federationEnabled, canAdminister }),
      overviewNote: escapeHtml(buildOverviewNote({ effective, actorLabels, person, postGate, canAdminister })),
      accessList,
      homeStats,
      conversationSummary,
      governanceSummary: escapeHtml(governanceSummary),
      federationSummary,
      conversationActions: buildConversationActions({ socialEnabled }),
      governanceActions: buildGovernanceActions({ petitionsEnabled, delegationEnabled, groupsEnabled }),
      federationActions: buildFederationActions({ federationEnabled, canAdminister }),
      conversationList,
      governanceList,
      federationList,
      opsHidden,
      opsTitle: !effective.initialized ? 'Setup and operations' : 'Operator cues',
      opsList,
    },
    { wantsPartial, title: 'Home workspace', state },
  );
  return sendHtml(res, html);
}

function buildSummaryText({ person, actorLabels, postGate }) {
  if (!person) {
    return `Read public conversation now. Verify with wallet when you need a persistent ${actorLabels.actorLabel} handle, private alerts, proposals, or votes.`;
  }
  if (person.banned) {
    return `Signed in as ${person.handle}. This handle is currently banned, so actions stay blocked until a moderator changes the session status.`;
  }
  if (!postGate.allowed) {
    return `Signed in as ${person.handle}. Review the current Circle policy before acting: your session is present, but one or more participation gates are still blocked.`;
  }
  return `Signed in as ${person.handle}.`;
}

function buildOverviewNote({ effective, actorLabels, person, postGate, canAdminister }) {
  const notes = [
    `Circle ${effective.id} v${effective.version} · ${effective.circleName}`,
    `Hash-only identity: raw PID is never stored; accountability follows the blinded ${actorLabels.actorLabel} hash.`,
  ];
  if (!effective.initialized && canAdminister) {
    notes.push('Installation wizard is still pending in Admin.');
  }
  if (person && !postGate.allowed && postGate.message) {
    notes.push(postGate.message);
  }
  return notes.join(' ');
}

function buildOverviewActions({ person, federationEnabled, canAdminister }) {
  const links = [];
  if (!person) {
    links.push('<a class="ghost" href="/auth/eudi" data-partial>Verify with wallet</a>');
  } else {
    links.push('<a class="ghost" href="/notifications" data-partial>Notifications</a>');
  }
  if (canAdminister) {
    links.push('<a class="ghost" href="/admin" data-partial>Admin</a>');
  } else if (federationEnabled) {
    links.push('<a class="ghost" href="/circle/ledger" target="_blank" rel="noreferrer">Ledger</a>');
  }
  return links.join('\n');
}

function buildConversationActions({ socialEnabled }) {
  const links = [];
  if (socialEnabled) {
    links.push('<a class="ghost" href="/social/feed" data-partial>Open social feed</a>');
  }
  links.push('<a class="ghost" href="/discussion" data-partial>Open discussion</a>');
  links.push('<a class="ghost" href="/forum" data-partial>Open forum</a>');
  return links.join('\n');
}

function buildGovernanceActions({ petitionsEnabled, delegationEnabled, groupsEnabled }) {
  const links = ['<a class="ghost" href="/governance" data-partial>Governance defaults</a>'];
  if (petitionsEnabled) {
    links.unshift('<a class="ghost" href="/petitions" data-partial>Open proposals</a>');
  }
  if (delegationEnabled) {
    links.push('<a class="ghost" href="/delegation" data-partial>Delegation</a>');
  }
  if (groupsEnabled) {
    links.push('<a class="ghost" href="/groups" data-partial>Groups</a>');
  }
  return links.join('\n');
}

function buildFederationActions({ federationEnabled, canAdminister }) {
  const links = ['<a class="ghost" href="/health" target="_blank" rel="noreferrer">Health</a>'];
  if (federationEnabled) {
    links.unshift('<a class="ghost" href="/circle/ledger" target="_blank" rel="noreferrer">Ledger export</a>');
  }
  if (canAdminister) {
    links.push('<a class="ghost" href="/admin#federation-gossip" data-partial>Gossip controls</a>');
  }
  return links.join('\n');
}

function buildConversationSummary({ socialEnabled, discussionCount, forumCount, followStats, publicSocialCount }) {
  const parts = [];
  if (socialEnabled) {
    parts.push(
      followStats
        ? `${followStats.follows.length} follow edges shaping the current wall`
        : `${publicSocialCount} public social posts visible`,
    );
  }
  parts.push(`${discussionCount} discussion threads`);
  parts.push(`${forumCount} forum articles`);
  return parts.join(' · ');
}

function buildGovernanceSummary({
  petitionsEnabled,
  delegationEnabled,
  groupsEnabled,
  voteStageCount,
  activePetitionCount,
  petitionGate,
}) {
  if (!petitionsEnabled) {
    return 'Formal governance modules are disabled. Discussion stays available without proposal or vote workflows.';
  }
  const parts = [`${activePetitionCount} active proposals`, `${voteStageCount} in vote stage`];
  parts.push(delegationEnabled ? 'Delegation enabled' : 'Delegation disabled');
  parts.push(groupsEnabled ? 'Groups enabled' : 'Groups disabled');
  if (!petitionGate.allowed && petitionGate.message) {
    parts.push(petitionGate.message);
  }
  return parts.join(' · ');
}

function buildFederationSummary({ federationEnabled, profile, policy, ledgerSize }) {
  const parts = [`Mode: ${describeProfile(profile)}`, `Gossip ${isGossipEnabled(profile) ? 'on' : 'off'}`, `${policy.peersKnown} peers`, `${ledgerSize} ledger entries`];
  if (!federationEnabled) {
    parts.push('Federation endpoints disabled; local audit trail still active');
  }
  return parts.join(' · ');
}

function buildAccessItem(label, gate, { detail = '' } = {}) {
  const allowed = gate?.allowed === true;
  return {
    label,
    status: allowed ? 'Allowed' : 'Blocked',
    detail: detail || gate?.message || '',
    tone: allowed ? 'ok' : 'warning',
  };
}

function allowGuestDetail(policy, gate) {
  if (!gate?.allowed) return '';
  if (policy.enforcement === 'strict') {
    return 'Posting is accountable to a verified handle in this Circle.';
  }
  return 'Open posting is allowed under the current observing policy.';
}

function listConversationEntries(state, person, { socialEnabled }) {
  const items = [];
  if (socialEnabled) {
    const socialFeed = buildPersonalizedHomeFeed(state, person);
    for (const entry of socialFeed.slice(0, CONVERSATION_LIMIT)) {
      items.push({ type: 'social', entry, createdAt: entry.createdAt || '' });
    }
  }

  const discussions = filterVisibleEntries(state.discussions || [], state, (entry) => isDiscussionEntry(entry)).slice(0, CONVERSATION_LIMIT);
  for (const entry of discussions) {
    items.push({ type: 'discussion', entry, createdAt: entry.createdAt || '' });
  }

  const forumThreads = filterVisibleEntries(state.discussions || [], state, (entry) => isForumThread(entry)).slice(0, CONVERSATION_LIMIT);
  for (const entry of forumThreads) {
    items.push({ type: 'forum', entry, createdAt: entry.createdAt || '' });
  }

  return items
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .slice(0, CONVERSATION_LIMIT);
}

function buildPersonalizedHomeFeed(state, person) {
  const preferred = buildFeed(state, person);
  if (preferred.length) return preferred;
  return buildFeed(state, null);
}

function formatConversationItem(item = {}) {
  const entry = item.entry || {};
  const createdAt = formatTimestamp(item.createdAt, 'Unknown date');
  if (item.type === 'forum') {
    return {
      title: entry.title || 'Forum article',
      summary: buildSnippet(entry.content || '', 110),
      meta: `${resolveTopic(entry)} · ${createdAt}`,
      href: forumThreadHref(entry.id),
      partial: true,
      pills: [{ label: 'Forum' }],
    };
  }
  if (item.type === 'discussion') {
    return {
      title: resolveTopic(entry),
      summary: buildSnippet(entry.content || '', 110),
      meta: `${createdAt} · ${entry.stance || 'discussion'}`,
      href: '/discussion',
      partial: true,
      pills: [{ label: 'Discussion' }],
    };
  }
  return {
    title: entry.authorHandle ? `@${entry.authorHandle}` : 'Social post',
    summary: buildSnippet(entry.content || describeSocialFallback(entry), 110),
    meta: createdAt,
    href: '/social/feed',
    partial: true,
    pills: [
      { label: 'Social' },
      entry.visibility === 'direct' ? { label: 'Direct', tone: 'warning' } : { label: 'Public' },
    ],
  };
}

function sortPetitionsForHome(entries = []) {
  const stageWeight = { vote: 0, discussion: 1, draft: 2, closed: 3 };
  return [...entries].sort((left, right) => {
    const stageDelta = (stageWeight[normalizePetitionStage(left?.status)] ?? 9) - (stageWeight[normalizePetitionStage(right?.status)] ?? 9);
    if (stageDelta !== 0) return stageDelta;
    const rightTime = Date.parse(right?.updatedAt || right?.createdAt || 0);
    const leftTime = Date.parse(left?.updatedAt || left?.createdAt || 0);
    return rightTime - leftTime;
  });
}

function formatGovernanceItem(entry = {}) {
  const stage = normalizePetitionStage(entry.status);
  const updatedAt = formatTimestamp(entry.updatedAt || entry.createdAt, 'Unknown date');
  return {
    title: entry.title || 'Proposal',
    summary: buildSnippet(entry.summary || entry.body || '', 120),
    meta: `${resolveTopic(entry)} · Updated ${updatedAt}`,
    href: proposalHref(entry),
    partial: true,
    pills: [{ label: displayPetitionStage(stage) }, entry.freeze ? { label: 'Frozen' } : null].filter(Boolean),
  };
}

function formatFederationItem(entry = {}, state) {
  const createdAt = formatTimestamp(entry.createdAt, 'Unknown date');
  const actorLabel = entry.actorHash ? `@${resolveHandleForHash(state, entry.actorHash)}` : '';
  return {
    title: humanizeTransactionType(entry.type),
    summary: summarizeTransaction(entry),
    meta: `${createdAt}${actorLabel ? ` · ${actorLabel}` : ''}`,
    href: '/admin#admin-transactions',
    partial: true,
    pills: [entry.validationStatus === 'preview' ? { label: 'Preview', tone: 'warning' } : { label: 'Validated' }],
  };
}

function buildOpsItems({ effective, federationEnabled, canAdminister, transactionEntries, policy, moduleSettings }) {
  const items = [];
  if (!effective.initialized && canAdminister) {
    items.push({
      title: 'Finish installation wizard',
      summary: 'Set Circle basics, data mode, and peer alignment before inviting more participants.',
      meta: `${policy.ledgerEntries} ledger entries · ${policy.peersKnown} peers known`,
      href: '/admin#wizard-step-1',
      partial: true,
      pills: [{ label: 'Setup', tone: 'warning' }],
    });
  }
  if (canAdminister) {
    items.push({
      title: 'Review module control center',
      summary: summarizeEnabledModules(moduleSettings),
      meta: 'Admin keeps lane activation and settings aligned.',
      href: '/admin#modules',
      partial: true,
      pills: [{ label: 'Admin' }],
    });
  }
  if (federationEnabled && canAdminister) {
    items.push({
      title: 'Check gossip and peer health',
      summary: transactionEntries.length
        ? `Recent audit events: ${transactionEntries.length}.`
        : 'Cross-provider sync is enabled; verify peer health before higher-stakes votes.',
      meta: `${policy.peersKnown} peers configured`,
      href: '/admin#federation-gossip',
      partial: true,
      pills: [{ label: 'Federation' }],
    });
  }
  return items;
}

function summarizeEnabledModules(moduleSettings = {}) {
  const enabled = Object.entries(moduleSettings)
    .filter(([, value]) => value !== false)
    .map(([key]) => key);
  return enabled.length ? `Enabled modules: ${enabled.join(', ')}` : 'No optional modules enabled.';
}

function normalizePetitionStage(value) {
  const raw = String(value || 'draft').toLowerCase();
  if (raw === 'open') return 'vote';
  if (raw === 'discussion' || raw === 'vote' || raw === 'closed') return raw;
  return 'draft';
}

function displayPetitionStage(value) {
  if (value === 'vote') return 'Vote stage';
  if (value === 'discussion') return 'Discussion';
  if (value === 'closed') return 'Closed';
  return 'Draft';
}

function isDiscussionEntry(entry = {}) {
  if (entry.petitionId) return false;
  if (entry.parentId) return false;
  if (entry.stance === 'article' || entry.stance === 'comment') return false;
  return matchesGroupScope(entry, null);
}

function resolveTopic(entry = {}) {
  if (Array.isArray(entry.topicPath) && entry.topicPath.length) {
    return entry.topicPath.join(' / ');
  }
  if (entry.topicBreadcrumb) return entry.topicBreadcrumb;
  return entry.topic || 'general';
}

function buildSnippet(value, maxLength = 120) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function describeSocialFallback(entry = {}) {
  if (entry.reshareOf) return 'Reshared a post';
  if (Array.isArray(entry.mediaIds) && entry.mediaIds.length) return 'Shared a media post';
  return 'Shared an update';
}

function humanizeTransactionType(type = '') {
  const normalized = String(type || '').trim();
  if (!normalized) return 'Audit event';
  return normalized
    .split('_')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

function summarizeTransaction(entry = {}) {
  const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
  if (payload.title) return buildSnippet(payload.title, 96);
  if (payload.summary) return buildSnippet(payload.summary, 96);
  if (payload.topic) return `Topic: ${payload.topic}`;
  if (payload.threadId) return `Thread ${payload.threadId}`;
  if (payload.discussionId) return `Discussion ${payload.discussionId}`;
  if (entry.petitionId) return `Petition ${entry.petitionId}`;
  return 'Signed local audit entry.';
}
