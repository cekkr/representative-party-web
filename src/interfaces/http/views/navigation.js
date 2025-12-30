import { resolveModuleSettings } from '../../modules/circle/modules.js';

const NAV_ITEMS = [
  { key: 'home', label: 'Home', href: '/', partial: true },
  { key: 'auth', label: 'Wallet Login (demo)', href: '/auth/eudi', partial: true },
  { key: 'discussion', label: 'Discussion', href: '/discussion', partial: true },
  { key: 'social', label: 'Social', href: '/social/feed', module: 'social', partial: true },
  { key: 'forum', label: 'Forum', href: '/forum', partial: true },
  { key: 'petitions', label: 'Proposals/Vote', href: '/petitions', module: 'petitions', partial: true },
  { key: 'groups', label: 'Groups', href: '/groups', module: 'groups', partial: true },
  { key: 'notifications', label: 'Notifications', href: '/notifications', partial: true },
  { key: 'admin', label: 'Admin', href: '/admin', partial: true },
  { key: 'health', label: 'Health', href: '/health', target: '_blank', rel: 'noreferrer', partial: false },
];

export function renderNav(state) {
  const modules = resolveModuleSettings(state);
  return NAV_ITEMS.filter((item) => {
    if (!item.module) return true;
    return modules[item.module] !== false;
  })
    .map((item) => {
      const attributes = [];
      if (item.partial) attributes.push('data-partial');
      if (item.target) attributes.push(`target="${item.target}"`);
      if (item.rel) attributes.push(`rel="${item.rel}"`);
      if (item.module) attributes.push(`data-module="${item.module}"`);
      attributes.push(`data-nav="${item.key}"`);
      return `<a href="${item.href}" ${attributes.join(' ')}>${item.label}</a>`;
    })
    .join('\n');
}
