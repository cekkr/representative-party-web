import { sanitizeText } from '../../shared/utils/text.js';

const MAX_TOPIC_LENGTH = 64;
const MAX_TOPIC_DEPTH = 6;
const MAX_MATCH_KEYS = 16;

// A topic-scoped preference (a delegation, a group cachet) is stored against a single
// lowercased label — "environment". A proposal, though, is filed against the full path it
// was classified into — ["Environment", "Energy"] — and only its *leaf* label is passed
// around as `topic`. Comparing the two by exact string means a delegation on a parent
// category silently never applies to anything filed in one of its subcategories, which is
// the opposite of what "delegate this category to X" promises.
//
// These helpers produce the ordered list of keys a stored preference may legitimately be
// matched against, most specific first, so resolution can take the narrowest delegation
// the member actually expressed and fall back outward to `general`.

export function normalizeTopicMatchKey(value) {
  return sanitizeText(String(value || '').trim(), MAX_TOPIC_LENGTH).toLowerCase();
}

// Split a topic reference into path segments. Accepts an array (a stored `topicPath`), a
// separated string ("Environment / Energy"), or a bare label.
export function parseTopicSegments(rawTopic) {
  const source = Array.isArray(rawTopic) ? rawTopic : String(rawTopic ?? '').split(/[>/]/);
  const segments = source
    .map((entry) => normalizeTopicMatchKey(entry))
    .filter(Boolean);
  return segments.slice(0, MAX_TOPIC_DEPTH);
}

// Ordered candidate keys for `topic` (optionally with its full `topicPath`), most specific
// first. For a proposal filed under Environment / Energy the order is:
//
//   environment/energy  → the exact path
//   energy              → the leaf label on its own (what a member picks from a datalist)
//   environment         → the parent category
//   general             → the catch-all
//
// At each depth the joined prefix is offered before the bare label at that depth, because a
// member who wrote out the full path meant something narrower than one who named the label.
export function buildTopicMatchKeys(rawTopic, topicPath) {
  const pathSegments = parseTopicSegments(topicPath);
  const topicSegments = parseTopicSegments(rawTopic);

  // The leaf carried in `topic` is authoritative: a caller may hand us a stale or truncated
  // path, so append the topic's own segments when the path does not already end with them.
  let segments = pathSegments;
  const leaf = topicSegments[topicSegments.length - 1];
  if (!segments.length) {
    segments = topicSegments;
  } else if (leaf && segments[segments.length - 1] !== leaf) {
    segments = [...segments, ...topicSegments].slice(0, MAX_TOPIC_DEPTH);
  }

  const keys = [];
  const seen = new Set();
  const push = (key) => {
    if (!key || seen.has(key) || keys.length >= MAX_MATCH_KEYS) return;
    seen.add(key);
    keys.push(key);
  };

  for (let depth = segments.length; depth > 0; depth -= 1) {
    push(segments.slice(0, depth).join('/'));
    push(segments[depth - 1]);
  }
  push('general');
  return keys;
}

// Canonical form of a stored topic, so both sides of a comparison are shaped identically.
// A preference is stored as whatever the member typed, lowercased — "Energy / Solar" becomes
// "energy / solar", spaces and all — while match keys join segments as "energy/solar".
// Comparing those raw would miss every path a member wrote with spaces around the separator,
// which is the natural way to type one.
export function canonicalizeTopicKey(value) {
  const segments = parseTopicSegments(value);
  return segments.length ? segments.join('/') : normalizeTopicMatchKey(value);
}

// True when `storedTopic` is the key a preference was saved under and it covers `matchKeys`.
// Returns the match depth (0 = most specific) so callers can prefer the narrowest hit.
export function topicMatchRank(storedTopic, matchKeys = []) {
  const key = canonicalizeTopicKey(storedTopic);
  if (!key) return -1;
  return matchKeys.indexOf(key);
}
