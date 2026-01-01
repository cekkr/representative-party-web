import { normalizeTopicKey } from '../../../modules/topics/preferences.js';
import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';

export function buildTopicOptions({ anchors = [], pinned = [], preferences = [], entries = [] } = {}, { limit = 18 } = {}) {
  const topics = [];
  const seen = new Set();
  const pushTopic = (value) => {
    const label = sanitizeText(String(value || '').trim(), 48);
    if (!label) return;
    const key = normalizeTopicKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    topics.push(label);
  };

  for (const topic of preferences || []) pushTopic(topic);
  for (const topic of pinned || []) pushTopic(topic);
  for (const topic of anchors || []) pushTopic(topic);
  for (const entry of entries || []) pushTopic(entry.topic);

  return topics.slice(0, limit);
}

export function renderTopicFilterOptions(topics = [], selectedKey = '') {
  return (topics || [])
    .map((topic) => {
      const key = normalizeTopicKey(topic);
      const selected = key === selectedKey ? ' selected' : '';
      return `<option value="${escapeHtml(topic)}"${selected}>${escapeHtml(topic)}</option>`;
    })
    .join('\n');
}

export function renderTopicDatalist(topics = []) {
  return (topics || []).map((topic) => `<option value="${escapeHtml(topic)}"></option>`).join('\n');
}
