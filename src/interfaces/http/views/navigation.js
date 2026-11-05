import { resolveModuleSettings } from '../../../modules/circle/modules.js';
import { canAdministerProvider } from '../../../modules/identity/privileges.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { resolveComposerStyle, resolveComposerTextEscaped } from './composerView.js';

const NAV_ITEMS = [
  { key: 'home', label: 'Home', href: '/', partial: true },
  {
    key: 'coordination',
    label: 'Coordination',
    href: '/organization',
    module: 'coordination',
    partial: true,
  },
  {
    key: 'auth',
    label: 'Wallet Login',
    href: '/auth/eudi',
    partial: true,
    hideWhenVerified: true,
  },
  {
    key: 'social',
    label: 'Social feed',
    href: '/social/feed',
    module: 'social',
    partial: true,
    requiresVerified: true,
  },
  { key: 'discussion', label: 'Discussion', href: '/discussion', partial: true },
  { key: 'forum', label: 'Forum', href: '/forum', partial: true },
  { key: 'petitions', label: 'Proposals', href: '/petitions', module: 'petitions', partial: true },
  { key: 'governance', label: 'Governance', href: '/governance', partial: true },
  { key: 'delegation', label: 'Delegation', href: '/delegation', module: 'delegation', partial: true },
  { key: 'delegates', label: 'People', href: '/delegates', module: 'delegation', partial: true },
  { key: 'groups', label: 'Groups', href: '/groups', module: 'groups', partial: true },
  {
    key: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    partial: true,
    requiresVerified: true,
  },
  {
    key: 'profile',
    label: 'Profile',
    href: '/profile',
    partial: true,
    requiresVerified: true,
  },
  {
    key: 'admin',
    label: 'Admin',
    href: '/admin',
    partial: true,
    requiresAdmin: true,
  },
  { key: 'health', label: 'Health', href: '/health', target: '_blank', rel: 'noreferrer' },
];

const NAV_GROUPS = [
  { key: 'start', label: 'Workspace', keys: ['home'] },
  { key: 'conversation', label: 'Conversation', keys: ['discussion', 'forum', 'notifications', 'social'] },
  { key: 'organization', label: 'Organization', keys: ['coordination'] },
  { key: 'governance', label: 'Civic governance', keys: ['petitions', 'delegation', 'delegates', 'groups', 'governance'] },
  { key: 'account', label: 'Account', keys: ['profile', 'auth'] },
  { key: 'operations', label: 'Operations', keys: ['admin', 'health'] },
];

const QUICK_ACTIONS = new Map([
  ['home', 'Home'],
  ['coordination', 'Coordination'],
  ['auth', 'Wallet Login'],
  ['social', 'Social'],
  ['forum', 'Forum'],
  ['notifications', 'Alerts'],
  ['profile', 'Profile'],
]);

const CONTEXT_ACTIONS = {
  home: { key: 'discussion-compose', label: 'New post' },
  discussion: { key: 'discussion-compose', label: 'New post' },
  forum: { key: 'forum-compose', label: 'New article' },
  social: { key: 'social-compose', label: 'New post' },
  petitions: { key: 'petitions-compose', label: 'New proposal' },
};

const NAV_PAGE_KEYS = {
  'auth-eudi': 'auth',
  'verification-complete': 'auth',
  'delegate-directory': 'delegates',
  'delegate-profile': 'delegates',
};

const CHILD_SECTIONS = {
  home: [
    { label: 'Workspace', href: '/#home-overview', partial: true },
    { label: 'Access', href: '/#home-access', partial: true },
    { label: 'Lane activity', href: '/#home-lanes', partial: true },
    { label: 'Operations', href: '/#home-ops', partial: true },
  ],
  coordination: [
    { label: 'Case workspace', href: '/organization#organization-case-work', partial: true },
    { label: 'Case queue', href: '/organization#organization-case-queue', partial: true },
    { label: 'Workspace preview', href: '/organization?view=preview#pressure-inbox', partial: true },
  ],
  social: [
    { label: 'Feed', href: '/social/feed#social-wall', partial: true },
    { label: 'Follows', href: '/social/feed#social-follows', partial: true },
  ],
  discussion: [
    { label: 'Latest contributions', href: '/discussion#discussion-feed', partial: true },
    { label: 'Topic preferences', href: '/discussion#discussion-topics', partial: true },
  ],
  forum: [
    { label: 'Threads', href: '/forum#forum-threads', partial: true },
  ],
  petitions: [
    { label: 'Active deliberations', href: '/petitions#petitions-discussion', partial: true },
    { label: 'Active proposals', href: '/petitions#petitions-active', partial: true },
  ],
  admin: [
    { label: 'Circle settings', href: '/admin#circle-settings', partial: true },
    { label: 'Governance defaults', href: '/admin#governance-settings', partial: true },
    { label: 'Topic gardener', href: '/admin#topic-gardener-review', partial: true },
    { label: 'Gossip sync', href: '/admin#federation-gossip', partial: true },
    { label: 'Provider-blind', href: '/admin#provider-blind', partial: true },
    { label: 'Modules', href: '/admin#modules', partial: true },
    { label: 'Composer', href: '/admin#composer', partial: true },
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
  const composer = state?.settings?.composer || {};
  const navContext = {
    isVerified: Boolean(context.person || context.isVerified),
    canAdminister: canAdministerProvider(context.person, state),
    currentKey: NAV_PAGE_KEYS[context.pageKey] || context.pageKey,
    quickOrder: Array.isArray(composer.quickActionsOrder) ? composer.quickActionsOrder : [],
    sideOrder: Array.isArray(composer.sideNavOrder) ? composer.sideNavOrder : [],
    textOverrides: context.textOverrides,
    styleOverrides: context.styleOverrides,
  };
  const destinations = NAV_ITEMS.filter((item) => isItemAllowed(item, modules, navContext));
  const byKey = new Map(destinations.map((item) => [item.key, item]));
  const currentItem = byKey.get(navContext.currentKey);
  const navLocation = currentItem
    ? resolveComposerTextEscaped(navContext.textOverrides, `nav.item.${currentItem.key}`, currentItem.label)
    : escapeHtml(context.title || '');
  const sideNav = NAV_GROUPS.map((group) => renderNavGroup(group, byKey, navContext))
    .filter(Boolean)
    .join('\n');
  const quickItems = destinations.filter((item) => QUICK_ACTIONS.has(item.key))
    .map((item) => ({ ...item, label: QUICK_ACTIONS.get(item.key) }));
  const createAction = context.workspaceCreateHref && currentItem && CONTEXT_ACTIONS[navContext.currentKey];
  const renderCreate = (className) => {
    if (!createAction) return '';
    const extraAttrs = navContext.currentKey === 'discussion' ? ['data-discussion-compose-link'] : [];
    return renderLink({ ...createAction, href: context.workspaceCreateHref, partial: true }, { className, extraAttrs, navContext });
  };
  const quickLinks = applyOrder(quickItems, navContext.quickOrder)
    .map((item) => renderLink(item, { className: 'quick-link', navContext }))
    .concat(renderCreate('quick-link quick-link--context'))
    .filter(Boolean)
    .join('\n');
  const navCreate = renderCreate('quick-link side-nav__create');
  return { sideNav, quickLinks, navCreate, navLocation };
}

function renderNavGroup(group, byKey, navContext) {
  const items = group.keys.map((key) => byKey.get(key)).filter(Boolean);
  const orderedItems = applyOrder(items, navContext.sideOrder);
  if (!orderedItems.length) return '';
  const links = orderedItems.map((item) => renderSideItem(item, navContext)).join('\n');
  const groupKey = `nav.group.${group.key}`;
  const groupLabel = resolveComposerTextEscaped(navContext.textOverrides, groupKey, group.label);
  const groupStyle = resolveComposerStyle(navContext.styleOverrides, groupKey);
  const groupAttrs = [
    `data-composer-key="${escapeHtml(groupKey)}"`,
    `data-composer-default="${escapeHtml(group.label)}"`,
    groupStyle ? `style="${escapeHtml(groupStyle)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `
    <div class="side-nav__group">
      <p class="eyebrow side-nav__group-title" ${groupAttrs}>${groupLabel}</p>
      ${links}
    </div>
  `;
}

function renderSideItem(item, navContext) {
  const childSections = CHILD_SECTIONS[item.key] || [];
  const isActive = item.key === navContext.currentKey;
  const link = renderLink(item, {
    className: 'side-nav__link',
    extraAttrs: ['data-nav-link', isActive ? 'aria-current="page"' : ''],
    navContext,
  });
  const children = childSections.length ? `
      <div class="side-nav__children" data-nav-children="${item.key}" ${isActive ? '' : 'hidden'}>
        ${childSections.map((child) => renderLink(child, { className: 'side-nav__child', navContext })).join('\n')}
      </div>` : '';
  return `
    <div class="side-nav__item${isActive ? ' is-active' : ''}" data-nav-section="${item.key}">
      ${link}${children}
    </div>
  `;
}

function renderLink(item, { className, extraAttrs = [], navContext } = {}) {
  const attributes = [];
  const labelKey = item.key ? `nav.item.${item.key}` : '';
  const label = resolveComposerTextEscaped(navContext?.textOverrides, labelKey, item.label);
  const style = labelKey ? resolveComposerStyle(navContext?.styleOverrides, labelKey) : '';
  if (item.partial) attributes.push('data-partial');
  if (item.target) attributes.push(`target="${item.target}"`);
  if (item.rel) attributes.push(`rel="${item.rel}"`);
  if (item.module) attributes.push(`data-module="${item.module}"`);
  if (className) attributes.push(`class="${className}"`);
  if (item.key) {
    attributes.push(`data-nav-key="${escapeHtml(item.key)}"`);
    attributes.push(`data-composer-key="${escapeHtml(labelKey)}"`);
    attributes.push(`data-composer-default="${escapeHtml(item.label)}"`);
  }
  if (style) {
    attributes.push(`style="${escapeHtml(style)}"`);
  }
  return `<a href="${escapeHtml(item.href)}" ${attributes.concat(extraAttrs).filter(Boolean).join(' ')}>${label}</a>`;
}

function isItemAllowed(item, modules, navContext) {
  if (item.module && modules[item.module] === false) return false;
  if (item.requiresVerified && !navContext.isVerified) return false;
  if (item.hideWhenVerified && navContext.isVerified) return false;
  if (item.requiresAdmin && !navContext.canAdminister) return false;
  return true;
}

function applyOrder(items, order = []) {
  if (!order || !order.length) return items;
  const byKey = new Map(items.map((item) => [item.key, item]));
  const ordered = [];
  for (const key of order) {
    const match = byKey.get(key);
    if (match) {
      ordered.push(match);
      byKey.delete(key);
    }
  }
  for (const item of items) {
    if (byKey.has(item.key)) {
      ordered.push(item);
      byKey.delete(item.key);
    }
  }
  return ordered;
}
