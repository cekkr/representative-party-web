import { findVisibleEntry } from '../federation/replication.js';
import { resolveGroupScope } from '../groups/groupScope.js';

export function isDiscussionPost(entry) {
  return Boolean(entry && !entry.petitionId && !entry.parentId &&
    entry.stance !== 'article' && entry.stance !== 'comment');
}

export function discussionHref({ groupId, post, q, topic, page, compose } = {}) {
  const params = new URLSearchParams();
  if (groupId) params.set('group', groupId);
  if (q) params.set('q', q);
  if (topic) params.set('topic', topic);
  if (page > 1) params.set('page', page);
  if (post) params.set('post', post);
  if (compose) params.set('compose', 'post');
  return params.size ? `/discussion?${params}` : '/discussion';
}

// Resolve a contribution by id through its stored lane and preview visibility.
// Focused reads, promotion writes, and inbox links share this gate.
export function findDiscussionRecord(state, person, id) {
  const entry = id && findVisibleEntry(state.discussions, state, (item) => item?.id === id && isDiscussionPost(item));
  if (!entry) return null;
  const scope = resolveGroupScope(state, person, entry.groupId, { lane: 'discussion' });
  return scope.ok ? { entry, scope } : null;
}
