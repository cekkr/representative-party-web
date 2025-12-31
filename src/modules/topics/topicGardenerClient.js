import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export const DEFAULT_TOPIC_ANCHORS = ['general', 'governance', 'economy', 'society', 'technology'];

// Returns normalized topic gardener settings with safe defaults so callers can
// rely on anchors without checking for undefined fields.
export function getTopicConfig(state) {
  const envUrl = process.env.TOPIC_GARDENER_URL || process.env.CIRCLE_TOPIC_GARDENER_URL || '';
  const envAnchors = parseEnvList(process.env.TOPIC_GARDENER_ANCHORS, DEFAULT_TOPIC_ANCHORS);
  const envPinned = parseEnvList(process.env.TOPIC_GARDENER_PINNED, []);
  const settings = state?.settings?.topicGardener || {};
  const anchors = normalizeList(settings.anchors?.length ? settings.anchors : envAnchors);
  const pinned = normalizeList(settings.pinned?.length ? settings.pinned : envPinned);
  return {
    url: settings.url || envUrl,
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

export async function fetchGardenerOperations(state) {
  const config = getTopicConfig(state);
  if (state?.helpers?.topicGardener?.operations) {
    try {
      const result = await state.helpers.topicGardener.operations();
      return Array.isArray(result) ? result : result?.operations || [];
    } catch (error) {
      console.warn(`[topic-gardener] helper operations failed: ${error.message}`);
      return [];
    }
  }
  if (!config.url) return [];
  const operationsUrl = resolveGardenerEndpoint(config.url, '/operations');
  if (!operationsUrl) return [];
  try {
    const response = await getJson(operationsUrl);
    return Array.isArray(response?.operations) ? response.operations : [];
  } catch (error) {
    console.warn(`[topic-gardener] operations request failed: ${error.message}`);
  }
  return [];
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

function parseEnvList(value, fallback = []) {
  if (!value) return fallback;
  const parts = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}

function resolveGardenerEndpoint(urlString, endpoint) {
  if (!urlString) return '';
  try {
    const url = new URL(urlString);
    const trimmed = url.pathname.replace(/\/+$/, '');
    const suffix = trimmed.endsWith('/classify') ? trimmed.slice(0, -'/classify'.length) : trimmed;
    const base = suffix || '';
    url.pathname = `${base}${endpoint}`;
    return url.toString();
  } catch (_error) {
    return '';
  }
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

function getJson(urlString) {
  const url = new URL(urlString);
  const isHttps = url.protocol === 'https:';
  const options = {
    method: 'GET',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search || ''}`,
    headers: { Accept: 'application/json' },
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
    req.end();
  });
}
