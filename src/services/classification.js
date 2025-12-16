import { createHash } from 'node:crypto';

import { classifyWithGardener, DEFAULT_TOPIC_ANCHORS, getTopicConfig } from './topicGardenerClient.js';

// Cache classifications to avoid redundant calls to the topic gardener/helper
// for the same payload and anchor set. Cache stays in-memory (no persistence).
const cache = new Map();

// Abstract topic classification hook. Extensions can implement classifyTopic(text, state)
// to return a topic/category string. A topic gardener helper can also respond with a
// reconciled topic that respects admin anchors and user pins.
export async function classifyTopic(text, state) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  const config = getTopicConfig(state);
  const anchors = config.anchors || DEFAULT_TOPIC_ANCHORS;
  const pinned = config.pinned || [];
  if (!normalizedText) return anchors[0] || 'general';

  const cacheKey = buildCacheKey(normalizedText, anchors, pinned);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const candidates = [];

  const gardener = await classifyWithGardener(normalizedText, state, { anchors, pinned });
  if (gardener?.topic) {
    candidates.push({ topic: gardener.topic, source: gardener.provider || 'topic-gardener' });
  }

  const extensions = state?.extensions?.active || [];
  for (const extension of extensions) {
    if (typeof extension.classifyTopic === 'function') {
      try {
        const topic = await Promise.resolve(extension.classifyTopic(normalizedText, state));
        if (topic) {
          candidates.push({ topic, source: extension.id || 'extension' });
        }
      } catch (error) {
        console.warn(`[classification] extension classifyTopic failed: ${error.message}`);
      }
    }
  }

  const resolved = pickTopic(candidates, anchors, pinned);
  cache.set(cacheKey, resolved);
  return resolved;
}

function pickTopic(candidates, anchors, pinned) {
  const anchorMap = buildTopicMap(anchors.length ? anchors : DEFAULT_TOPIC_ANCHORS);
  const pinnedMap = buildTopicMap(pinned);

  for (const candidate of candidates) {
    const slug = normalizeTopic(candidate.topic);
    const pinnedMatch = findMatch(slug, pinnedMap);
    if (pinnedMatch) return pinnedMatch;
  }

  for (const candidate of candidates) {
    const slug = normalizeTopic(candidate.topic);
    const anchorMatch = findMatch(slug, anchorMap);
    if (anchorMatch) return anchorMatch;
  }

  if (candidates.length) {
    return normalizeTopic(candidates[0].topic);
  }

  const [firstAnchor] = anchorMap.values();
  return firstAnchor || 'general';
}

function buildTopicMap(topics) {
  const map = new Map();
  for (const topic of topics || []) {
    const normalized = normalizeTopic(topic);
    if (!normalized) continue;
    if (!map.has(normalized)) {
      map.set(normalized, normalized);
    }
  }
  return map;
}

function findMatch(slug, targetMap) {
  for (const [candidate, label] of targetMap.entries()) {
    if (slug === candidate || slug.startsWith(candidate) || candidate.startsWith(slug)) {
      return label;
    }
  }
  return null;
}

function normalizeTopic(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'general';
}

function buildCacheKey(text, anchors, pinned) {
  const hash = createHash('sha256').update(text).digest('hex');
  const anchorKey = (anchors || []).map(normalizeTopic).join(',');
  const pinnedKey = (pinned || []).map(normalizeTopic).join(',');
  return `${hash}:${anchorKey}:${pinnedKey}`;
}
