import { createJsonAdapter } from './json.js';
import { createMemoryAdapter } from './memory.js';

const REGISTRY = {
  json: createJsonAdapter,
  memory: createMemoryAdapter,
};

export function resolveAdapter(name = 'json') {
  const normalized = normalizeAdapter(name);
  return REGISTRY[normalized] || REGISTRY.json;
}

export function listAdapters() {
  return Object.keys(REGISTRY);
}

export function normalizeAdapter(name) {
  if (!name) return 'json';
  return String(name).trim().toLowerCase();
}
