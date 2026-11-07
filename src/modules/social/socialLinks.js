import { canReadSocialPost, findPost } from './posts.js';

// The focused view of one Social update. Every consumer (wall permalinks, reply
// redirects, the inbox) builds the URL here so the shape stays in one place.
export function socialPostHref(postId, { anchor = '' } = {}) {
  const base = `/social/feed?post=${encodeURIComponent(postId)}`;
  return anchor ? `${base}#${anchor}` : base;
}

// Resolve a post by id through the same audience gate a direct read uses.
export function findReadableSocialPost(state, person, postId) {
  const post = postId ? findPost(state, postId) : null;
  return post && canReadSocialPost(state, person, post) ? post : null;
}
