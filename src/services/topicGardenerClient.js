import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export const DEFAULT_TOPIC_ANCHORS = ['general', 'governance', 'economy', 'society', 'technology'];

// Returns normalized topic gardener settings with safe defaults so callers can
// rely on anchors without checking for undefined fields.
export function getTopicConfig(state) {
  const settings = state?.settings?.topicGardener || {};
  const anchors = normalizeList(settings.anchors);
  const pinned = normalizeList(settings.pinned);
  return {
    url: settings.url || '',
    anchors: anchors.length ? anchors : DEFAULT_TOPIC_ANCHORS,
    pinned,
  };
}

export function getTopicAnchors(state) {
  return getTopicConfig(state).anchors;
}

// Invoke the Python topic gardener helper if configured (or a locally injected
// helper) to classify text without duplicating work across providers.
export async function classifyWithGardener(text, state, { anchors, pinned } = {}) {
  const config = getTopicConfig(state);
  const anchorList = anchors || config.anchors;
  const pinnedList = pinned || config.pinned;

  // Allow injecting a local helper (used by tests or when embedding the Python
  // worker in-process).
  if (state?.helpers?.topicGardener?.classify) {
    try {
      const result = await state.helpers.topicGardener.classify({ text, anchors: anchorList, pinned: pinnedList });
      if (result?.topic) {
        return { topic: result.topic, provider: result.provider || 'topic-gardener', anchors: anchorList, pinned: pinnedList };
      }
    } catch (error) {
      console.warn(`[topic-gardener] helper classify failed: ${error.message}`);
    }
  }

  if (!config.url) return null;

  try {
    const response = await postJson(config.url, { text, anchors: anchorList, pinned: pinnedList });
    if (response?.topic) {
      return {
        topic: response.topic,
        provider: response.provider || 'topic-gardener',
        anchors: response.anchors || anchorList,
        pinned: response.pinned || pinnedList,
      };
    }
  } catch (error) {
    console.warn(`[topic-gardener] request failed: ${error.message}`);
  }

  return null;
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  const deduped = new Set(
    list
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean),
  );
  return [...deduped];
}

function postJson(urlString, payload) {
  const url = new URL(urlString);
  const isHttps = url.protocol === 'https:';
  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search || ''}`,
    headers: { 'Content-Type': 'application/json' },
  };

  return new Promise((resolve, reject) => {
    const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        if (!raw) return resolve({});
        try {
          const parsed = JSON.parse(raw);
          return resolve(parsed);
        } catch (_error) {
          return reject(new Error('Invalid JSON response from topic gardener'));
        }
      });
    });

    req.on('error', (error) => reject(error));
    req.setTimeout(2000, () => {
      req.destroy(new Error('Topic gardener request timed out'));
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}
