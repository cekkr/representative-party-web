export function isForumThread(entry) {
  return Boolean(entry && !entry.groupId && !entry.petitionId && !entry.parentId && entry.stance === 'article');
}

export function forumThreadHref(id, { q, page } = {}) {
  const params = new URLSearchParams({ thread: id });
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  return `/forum?${params}`;
}
