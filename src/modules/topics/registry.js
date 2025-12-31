import { randomUUID } from 'node:crypto';

import { persistTopics } from '../../infra/persistence/storage.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { stampLocalEntry } from '../federation/replication.js';

const MAX_TOPIC_LABEL = 64;
const MAX_TOPIC_DEPTH = 6;

export function parseTopicPath(rawTopic) {
  const text = typeof rawTopic === 'string' ? rawTopic.trim() : '';
  if (!text) return ['general'];
  const parts = text
    .split(/[>/]/)
    .map((entry) => sanitizeText(entry.trim(), MAX_TOPIC_LABEL))
    .filter(Boolean);
  const normalized = parts.length ? parts : ['general'];
  return normalized.slice(0, MAX_TOPIC_DEPTH);
}

export function normalizeTopicLabel(value) {
  const label = sanitizeText(String(value || '').trim(), MAX_TOPIC_LABEL);
  return label || 'general';
}

export function normalizeTopicKey(value) {
  const text = String(value || '').trim().toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'general';
}

export function findTopicById(state, topicId) {
  if (!topicId) return null;
  return (state?.topics || []).find((topic) => topic.id === topicId) || null;
}

export function findTopicByPathKey(state, pathKey) {
  if (!pathKey) return null;
  return (state?.topics || []).find((topic) => topic.pathKey === pathKey) || null;
}

export function resolveTopicPath(state, topicId) {
  if (!topicId) return [];
  const topics = state?.topics || [];
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const path = [];
  const seen = new Set();
  let current = byId.get(topicId) || null;
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return path;
}

export function formatTopicBreadcrumb(state, topicId, { separator = ' / ' } = {}) {
  const path = resolveTopicPath(state, topicId);
  if (!path.length) return '';
  return path.map((topic) => topic.label || topic.key || 'general').join(separator);
}

export async function ensureTopicPath(state, rawTopic, { source = 'manual', persist = true } = {}) {
  if (!state) return { topic: null, path: [] };
  if (!state.topics) state.topics = [];

  const labels = parseTopicPath(rawTopic);
  const path = [];
  let parentId = null;
  let parentPathKey = '';
  let updated = false;

  for (let index = 0; index < labels.length; index += 1) {
    const label = normalizeTopicLabel(labels[index]);
    const key = normalizeTopicKey(label);
    const pathKey = parentPathKey ? `${parentPathKey}/${key}` : key;
    let topic = findTopicByPathKey(state, pathKey);

    if (!topic) {
      const now = new Date().toISOString();
      const entry = stampLocalEntry(state, {
        id: randomUUID(),
        key,
        label,
        slug: key,
        parentId,
        pathKey,
        depth: index,
        aliases: [],
        history: [],
        source,
        createdAt: now,
        updatedAt: now,
      });
      state.topics.unshift(entry);
      topic = entry;
      updated = true;
    } else if (label && label !== topic.label) {
      const now = new Date().toISOString();
      const aliases = new Set(Array.isArray(topic.aliases) ? topic.aliases : []);
      aliases.add(label);
      topic.aliases = [...aliases];
      topic.updatedAt = now;
      topic.history = [
        ...(Array.isArray(topic.history) ? topic.history : []),
        { at: now, action: 'alias', label },
      ].slice(-20);
      updated = true;
    }

    path.push(topic);
    parentId = topic.id;
    parentPathKey = pathKey;
  }

  if (updated && persist && state?.store?.saveTopics) {
    await persistTopics(state);
  }

  return { topic: path[path.length - 1] || null, path };
}
