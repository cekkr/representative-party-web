import { sanitizeText } from '../../shared/utils/text.js';
import { upsertProviderAttributes } from '../structure/structureManager.js';

const DEFAULT_LIMIT = 8;
const MAX_TOPIC_LENGTH = 48;

export function normalizeTopicKey(value) {
  return sanitizeText(String(value || ''), MAX_TOPIC_LENGTH).toLowerCase();
}

export function parseTopicList(raw, { limit = DEFAULT_LIMIT } = {}) {
  const entries = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\n,]/)
      : [];
  const topics = [];
  const seen = new Set();
  for (const entry of entries) {
    const label = sanitizeText(String(entry || '').trim(), MAX_TOPIC_LENGTH);
    if (!label) continue;
    const key = normalizeTopicKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    topics.push(label);
    if (topics.length >= limit) break;
  }
  return topics;
}

export function formatTopicList(topics = []) {
  return topics.length ? topics.join(', ') : '';
}

export function getTopicPreferences(state, person) {
  if (!state || !person) return [];
  const attrs = findProviderAttributes(state, person.sessionId, person.handle);
  const provider = attrs?.provider || {};
  const raw =
    provider.preferredTopics ??
    provider.preferred_topics ??
    provider.topicPreferences ??
    provider.topic_preferences ??
    [];
  return parseTopicList(raw);
}

export function storeTopicPreferences(state, person, rawTopics) {
  if (!state || !person?.sessionId) return [];
  const topics = parseTopicList(rawTopics);
  upsertProviderAttributes(state, {
    sessionId: person.sessionId,
    handle: person.handle,
    attributes: { preferredTopics: topics },
  });
  return topics;
}

function findProviderAttributes(state, sessionId, handle) {
  const list = state.profileAttributes || [];
  if (sessionId) {
    const match = list.find((entry) => entry.sessionId === sessionId);
    if (match) return match;
  }
  if (handle) {
    const match = list.find((entry) => entry.handle === handle);
    if (match) return match;
  }
  return null;
}
