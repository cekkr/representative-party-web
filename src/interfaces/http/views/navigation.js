import { resolveModuleSettings } from '../../../modules/circle/modules.js';
import { getPrivilegesForPerson } from '../../../modules/identity/privileges.js';

const NAV_ITEMS = [
  { key: 'home', label: 'Home', href: '/', partial: true, match: { path: '/', exact: true } },
  {
    key: 'auth',
    label: 'Wallet Login',
    href: '/auth/eudi',
    partial: true,
    match: { prefix: '/auth' },
    hideWhenVerified: true,
  },
  {
    key: 'social',
    label: 'Wall',
    href: '/social/feed',
    module: 'social',
    partial: true,
    match: { prefix: '/social' },
    requiresVerified: true,
  },
  { key: 'discussion', label: 'Discussion', href: '/discussion', partial: true, match: { prefix: '/discussion' } },
  { key: 'forum', label: 'Forum', href: '/forum', partial: true, match: { prefix: '/forum' } },
  { key: 'petitions', label: 'Proposals', href: '/petitions', module: 'petitions', partial: true, match: { prefix: '/petitions' } },
  { key: 'governance', label: 'Governance', href: '/governance', partial: true, match: { prefix: '/governance' } },
  { key: 'delegation', label: 'Delegation', href: '/delegation', module: 'delegation', partial: true, match: { prefix: '/delegation' } },
  { key: 'groups', label: 'Groups', href: '/groups', module: 'groups', partial: true, match: { prefix: '/groups' } },
  {
    key: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    partial: true,
    match: { prefix: '/notifications' },
    requiresVerified: true,
  },
  {
    key: 'profile',
    label: 'Profile',
    href: '/profile',
    partial: true,
    match: { prefix: '/profile' },
    requiresVerified: true,
  },
  {
    key: 'admin',
    label: 'Admin',
    href: '/admin',
    partial: true,
    match: { prefix: '/admin' },
    requiresVerified: true,
  },
  { key: 'health', label: 'Health', href: '/health', target: '_blank', rel: 'noreferrer', partial: false, match: { prefix: '/health' } },
];

const NAV_GROUPS = [
  { label: 'Start', keys: ['home', 'auth', 'profile', 'notifications'] },
  { label: 'Conversation', keys: ['social', 'discussion', 'forum'] },
  { label: 'Governance', keys: ['petitions', 'delegation', 'groups', 'governance'] },
  { label: 'Operations', keys: ['admin', 'health'] },
];

const QUICK_ACTIONS = [
  { key: 'home', label: 'Info', href: '/', partial: true },
  { key: 'auth', label: 'Wallet Login', href: '/auth/eudi', partial: true, hideWhenVerified: true },
  { key: 'social', label: 'Wall', href: '/social/feed', module: 'social', partial: true, requiresVerified: true },
  { key: 'forum', label: 'Forum', href: '/forum', partial: true },
  { key: 'notifications', label: 'Alerts', href: '/notifications', partial: true, requiresVerified: true },
  { key: 'profile', label: 'Profile', href: '/profile', partial: true, requiresVerified: true },
];

const CONTEXT_ACTIONS = {
  social: [
    {
      key: 'social-compose',
      label: 'New Post',
      href: '/social/feed?compose=post#social-compose',
      partial: true,
      module: 'social',
      requiresVerified: true,
    },
  ],
  discussion: [
    { key: 'discussion-compose', label: 'New Post', href: '/discussion?compose=post#discussion-compose', partial: true },
  ],
  forum: [
    { key: 'forum-compose', label: 'New Article', href: '/forum?compose=thread#forum-compose', partial: true },
  ],
  petitions: [
    {
      key: 'petitions-compose',
      label: 'New Proposal',
      href: '/petitions?compose=proposal#petitions-compose',
      partial: true,
      module: 'petitions',
    },
  ],
  admin: [{ key: 'admin-modules', label: 'Modules', href: '/admin#modules', partial: true, requiresVerified: true }],
};

const CHILD_SECTIONS = {
  social: [
    { label: 'Wall', href: '/social/feed#social-wall', partial: true },
    { label: 'New post', href: '/social/feed?compose=post#social-compose', partial: true },
    { label: 'Follows', href: '/social/feed#social-follows', partial: true },
  ],
  discussion: [
    { label: 'New post', href: '/discussion?compose=post#discussion-compose', partial: true },
    { label: 'Topic preferences', href: '/discussion#discussion-topics', partial: true },
    { label: 'Latest contributions', href: '/discussion#discussion-feed', partial: true },
  ],
  forum: [
    { label: 'New article', href: '/forum?compose=thread#forum-compose', partial: true },
    { label: 'Threads', href: '/forum#forum-threads', partial: true },
  ],
  petitions: [
    { label: 'New proposal', href: '/petitions?compose=proposal#petitions-compose', partial: true },
    { label: 'Active proposals', href: '/petitions#petitions-active', partial: true },
    { label: 'Active deliberations', href: '/petitions#petitions-discussion', partial: true },
  ],
  admin: [
    { label: 'Circle settings', href: '/admin#circle-settings', partial: true },
    { label: 'Governance defaults', href: '/admin#governance-settings', partial: true },
    { label: 'Topic gardener', href: '/admin#topic-gardener-review', partial: true },
    { label: 'Gossip sync', href: '/admin#federation-gossip', partial: true },
    { label: 'Provider-blind', href: '/admin#provider-blind', partial: true },
    { label: 'Modules', href: '/admin#modules', partial: true },
    { label: 'Rate limits', href: '/admin#rate-limits', partial: true },
    { label: 'Social media', href: '/admin#social-media', partial: true },
    { label: 'Upload cleanup', href: '/admin#upload-cleanup', partial: true },
    { label: 'Structure manager', href: '/admin#structure-manager', partial: true },
    { label: 'Provider profiles', href: '/admin#provider-profiles', partial: true },
    { label: 'Admin audit', href: '/admin#admin-audit', partial: true },
    { label: 'Runtime metrics', href: '/admin#ops-metrics', partial: true },
    { label: 'Metrics retention', href: '/admin#metrics-retention', partial: true },
    { label: 'Transactions', href: '/admin#admin-transactions', partial: true },
    { label: 'Outbound delivery', href: '/admin#outbound-delivery', partial: true },
    { label: 'Transaction summaries', href: '/admin#transaction-summaries', partial: true },
    { label: 'Extensions', href: '/admin#extensions', partial: true },
    { label: 'Session overrides', href: '/admin#session-overrides', partial: true },
  ],
};

export function renderNav(state, context = {}) {
  const modules = resolveModuleSettings(state);
  const navContext = resolveNavContext(state, context);
  const sideNav = renderSideNav(modules, navContext);
  const quickLinks = renderQuickLinks(modules, navContext);
  return { sideNav, quickLinks };
}

function renderSideNav(modules, navContext) {
  const byKey = new Map(NAV_ITEMS.map((item) => [item.key, item]));
  return NAV_GROUPS.map((group) => renderNavGroup(group, byKey, modules, navContext))
    .filter(Boolean)
    .join('\n');
}

function renderNavGroup(group, byKey, modules, navContext) {
  const items = group.keys
    .map((key) => byKey.get(key))
    .filter((item) => item && isItemAllowed(item, modules, navContext));
  if (!items.length) return '';
  const links = items.map((item) => renderSideItem(item, modules, navContext)).join('\n');
  return `
    <div class="side-nav__group">
      <p class="eyebrow">${group.label}</p>
      ${links}
    </div>
  `;
}

function renderSideItem(item, modules, navContext) {
  const childSections = (CHILD_SECTIONS[item.key] || []).filter((child) => isItemAllowed(child, modules, navContext));
  const matchAttrs = buildMatchAttributes(item);
  return `
    <div class="side-nav__item" data-nav-section="${item.key}" ${matchAttrs}>
      ${renderLink(item, { className: 'side-nav__link', extraAttrs: ['data-nav-link'] })}
      <div class="side-nav__children" data-nav-children="${item.key}" hidden>
        ${childSections.map((child) => renderLink(child, { className: 'side-nav__child' })).join('\n')}
      </div>
    </div>
  `;
}

function renderQuickLinks(modules, navContext) {
  const globalLinks = QUICK_ACTIONS.filter((item) => isItemAllowed(item, modules, navContext));
  const contextLinks = Object.entries(CONTEXT_ACTIONS)
    .flatMap(([section, items]) =>
      items.filter((item) => isItemAllowed(item, modules, navContext)).map((item) => ({ ...item, section })),
    );
  const globalHtml = globalLinks.map((item) => renderLink(item, { className: 'quick-link' })).join('\n');
  const contextHtml = contextLinks
    .map((item) =>
      renderLink(item, {
        className: 'quick-link quick-link--context',
        extraAttrs: [`data-quick-section="${item.section}"`, 'hidden'],
      }),
    )
    .join('\n');
  return [globalHtml, contextHtml].filter(Boolean).join('\n');
}

function renderLink(item, { className, extraAttrs = [] } = {}) {
  const attributes = [];
  if (item.partial) attributes.push('data-partial');
  if (item.target) attributes.push(`target="${item.target}"`);
  if (item.rel) attributes.push(`rel="${item.rel}"`);
  if (item.module) attributes.push(`data-module="${item.module}"`);
  if (className) attributes.push(`class="${className}"`);
  return `<a href="${item.href}" ${attributes.concat(extraAttrs).join(' ')}>${item.label}</a>`;
}

function buildMatchAttributes(item) {
  const match = item.match || {};
  if (match.exact && match.path) {
    return `data-nav-path="${match.path}" data-nav-exact="true"`;
  }
  if (match.prefix) {
    return `data-nav-prefix="${match.prefix}"`;
  }
  return '';
}

function isItemAllowed(item, modules, navContext) {
  if (item.module && modules[item.module] === false) return false;
  if (item.requiresVerified && !navContext.isVerified) return false;
  if (item.hideWhenVerified && navContext.isVerified) return false;
  if (item.requiresModerate && !navContext.canModerate) return false;
  return true;
}

function resolveNavContext(state, context = {}) {
  if (context.person) {
    const privileges = getPrivilegesForPerson(context.person, state);
    return {
      isVerified: privileges.role !== 'guest',
      canModerate: privileges.canModerate,
      role: privileges.role,
    };
  }

  const roleLabel = context.roleLabel || context.role || '';
  const normalizedRole = roleLabel ? String(roleLabel).toLowerCase() : '';
  const explicitVerified = typeof context.isVerified === 'boolean';
  const isVerified = explicitVerified ? context.isVerified : normalizedRole ? normalizedRole !== 'guest' : false;
  if (normalizedRole) {
    return {
      isVerified,
      canModerate: normalizedRole === 'admin' || normalizedRole === 'moderator',
      role: normalizedRole,
    };
  }
  if (explicitVerified) {
    return {
      isVerified,
      canModerate: Boolean(context.canModerate),
      role: isVerified ? 'user' : 'guest',
    };
  }
  const handle = context.personHandle || '';
  const handleVerified = Boolean(handle && handle !== 'Guest session');
  return {
    isVerified: handleVerified,
    canModerate: false,
    role: handleVerified ? 'user' : 'guest',
  };
}
