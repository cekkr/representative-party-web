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
