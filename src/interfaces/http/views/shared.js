import { formatTopicBreadcrumb as formatTopicBreadcrumbFromRegistry } from '../../../modules/topics/registry.js';
import { escapeHtml } from '../../../shared/utils/text.js';

export function resolveTopicBreadcrumb(entry, state) {
  if (entry?.topicId && state) {
    const live = formatTopicBreadcrumbFromRegistry(state, entry.topicId);
    if (live) return live;
  }
  if (Array.isArray(entry?.topicPath) && entry.topicPath.length) {
    return entry.topicPath.join(' / ');
  }
  if (entry?.topicBreadcrumb) return entry.topicBreadcrumb;
  return entry?.topic || 'general';
}

export function renderIssuerPill(entry) {
  const issuer = entry?.issuer || entry?.provenance?.issuer;
  if (!issuer) return '';
  return `<span class="pill ghost">from ${escapeHtml(String(issuer))}</span>`;
}
