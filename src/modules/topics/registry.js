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

export function labelFromKey(value) {
  const text = String(value || '').trim();
  if (!text) return 'general';
  return normalizeTopicLabel(text.replace(/-/g, ' '));
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
  let safety = 0;
  while (current && current.mergedIntoId && safety < 8) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const next = byId.get(current.mergedIntoId);
    if (!next) break;
    current = next;
    safety += 1;
  }
  const pathSeen = new Set();
  while (current && !pathSeen.has(current.id)) {
    path.unshift(current);
    pathSeen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return path;
}

export function formatTopicBreadcrumb(state, topicId, { separator = ' / ' } = {}) {
  const path = resolveTopicPath(state, topicId);
  if (!path.length) return '';
  return path.map((topic) => topic.label || topic.key || 'general').join(separator);
}

export function applyTopicRename(state, topicId, { label, reason = 'manual', source = 'admin' } = {}) {
  if (!state) return { updated: false, reason: 'missing_state' };
  if (!state.topics) state.topics = [];
  const topic = findTopicById(state, topicId);
  if (!topic) return { updated: false, reason: 'not_found' };
  const previousLabel = topic.label;
  const previousKey = topic.key;
  const previousPathKey = topic.pathKey || previousKey || 'general';
  const nextLabel = normalizeTopicLabel(label || topic.pendingRename?.toLabel || previousLabel);
  const nextKey = normalizeTopicKey(topic.pendingRename?.toKey || nextLabel);
  const parent = topic.parentId ? findTopicById(state, topic.parentId) : null;
  const parentPathKey = parent?.pathKey || '';
  const newPathKey = parentPathKey ? `${parentPathKey}/${nextKey}` : nextKey;
  if (newPathKey !== previousPathKey) {
    const conflict = (state.topics || []).find((entry) => entry.id !== topic.id && entry.pathKey === newPathKey);
    if (conflict) {
      return { updated: false, reason: 'conflict', conflictId: conflict.id };
    }
  }

  const now = new Date().toISOString();
  const aliases = new Set(Array.isArray(topic.aliases) ? topic.aliases : []);
  if (previousLabel) aliases.add(previousLabel);
  topic.aliases = [...aliases];
  topic.label = nextLabel;
  topic.key = nextKey;
  topic.slug = nextKey;
  const oldPathPrefix = previousPathKey;
  const newPathPrefix = newPathKey;
  for (const entry of state.topics) {
    if (!entry?.pathKey) continue;
    if (entry.pathKey === oldPathPrefix) {
      entry.pathKey = newPathPrefix;
    } else if (entry.pathKey.startsWith(`${oldPathPrefix}/`)) {
      entry.pathKey = `${newPathPrefix}${entry.pathKey.slice(oldPathPrefix.length)}`;
    }
  }
  topic.updatedAt = now;
  topic.pendingRename = null;
  appendTopicHistory(topic, {
    at: now,
    action: 'rename',
    source,
    reason,
    fromLabel: previousLabel,
    toLabel: nextLabel,
    fromKey: previousPathKey,
    toKey: newPathKey,
  });
  return { updated: true, topic };
}

export function applyTopicMerge(state, fromTopicId, toTopicId, { reason = 'manual', source = 'admin' } = {}) {
  if (!state) return { updated: false, reason: 'missing_state' };
  if (!state.topics) state.topics = [];
  if (!fromTopicId || !toTopicId || fromTopicId === toTopicId) {
    return { updated: false, reason: 'invalid_target' };
  }
  const fromTopic = findTopicById(state, fromTopicId);
  const toTopic = findTopicById(state, toTopicId);
  if (!fromTopic || !toTopic) return { updated: false, reason: 'not_found' };
  if (fromTopic.mergedIntoId === toTopicId) {
    fromTopic.pendingMerge = null;
    return { updated: false, reason: 'already_merged' };
  }
  const now = new Date().toISOString();
  const aliases = new Set(Array.isArray(toTopic.aliases) ? toTopic.aliases : []);
  if (fromTopic.label) aliases.add(fromTopic.label);
  toTopic.aliases = [...aliases];
  toTopic.updatedAt = now;
  fromTopic.mergedIntoId = toTopicId;
  fromTopic.pendingMerge = null;
  fromTopic.archivedAt = now;
  fromTopic.updatedAt = now;
  appendTopicHistory(fromTopic, {
    at: now,
    action: 'merge',
    source,
    reason,
    fromLabel: fromTopic.label,
    toLabel: toTopic.label,
    fromKey: fromTopic.pathKey || fromTopic.key,
    toKey: toTopic.pathKey || toTopic.key,
  });
  appendTopicHistory(toTopic, {
    at: now,
    action: 'merge_into',
    source,
    reason,
    fromLabel: fromTopic.label,
    toLabel: toTopic.label,
    fromKey: fromTopic.pathKey || fromTopic.key,
    toKey: toTopic.pathKey || toTopic.key,
  });
  return { updated: true, fromTopic, toTopic };
}

export async function applyTopicSplit(
  state,
  topicId,
  { labels = [], reason = 'manual', source = 'admin', persist = true } = {},
) {
  if (!state) return { updated: false, reason: 'missing_state' };
  if (!state.topics) state.topics = [];
  const topic = findTopicById(state, topicId);
  if (!topic) return { updated: false, reason: 'not_found' };
  const cleaned = Array.from(
    new Set(
      labels
        .map((entry) => normalizeTopicLabel(entry))
        .filter(Boolean),
    ),
  );
  if (!cleaned.length) {
    topic.pendingSplit = null;
    return { updated: false, reason: 'empty_labels' };
  }

  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const label of cleaned) {
    const key = normalizeTopicKey(label);
    const pathKey = topic.pathKey ? `${topic.pathKey}/${key}` : key;
    const exists = findTopicByPathKey(state, pathKey);
    if (exists) {
      skipped += 1;
      continue;
    }
    const entry = stampLocalEntry(state, {
      id: randomUUID(),
      key,
      label,
      slug: key,
      parentId: topic.id,
      pathKey,
      depth: (topic.depth || 0) + 1,
      aliases: [],
      history: [],
      source,
      createdAt: now,
      updatedAt: now,
    });
    state.topics.unshift(entry);
    appendTopicHistory(entry, {
      at: now,
      action: 'split_child',
      source,
      reason,
      fromLabel: topic.label,
      toLabel: label,
      fromKey: topic.pathKey || topic.key,
      toKey: pathKey,
    });
    created += 1;
  }

  topic.pendingSplit = null;
  topic.updatedAt = now;
  appendTopicHistory(topic, {
    at: now,
    action: 'split',
    source,
    reason,
    fromLabel: topic.label,
    toLabel: cleaned.join(', '),
    fromKey: topic.pathKey || topic.key,
    toKey: cleaned.map((label) => `${topic.pathKey || topic.key}/${normalizeTopicKey(label)}`).join(', '),
  });

  if (created && persist && state?.store?.saveTopics) {
    await persistTopics(state);
  }
  return { updated: created > 0, created, skipped };
}

export function appendTopicHistory(topic, entry, { limit = 20 } = {}) {
  if (!topic || !entry) return;
  const history = Array.isArray(topic.history) ? topic.history : [];
  topic.history = [...history, entry].slice(-limit);
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
