import { loadExtensions, listAvailableExtensions } from '../extensions/registry.js';
import { persistSettings } from '../state/storage.js';
import { sendJson } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';

export async function getExtensions({ res, state }) {
  const available = await listAvailableExtensions(state);
  const active = (state.extensions?.active || []).map((ext) => ext.id);
  const enabled = state.settings?.extensions || [];
  return sendJson(res, 200, { available, active, enabled });
}

export async function toggleExtension({ req, res, state }) {
  const body = await readRequestBody(req);
  const id = sanitizeText(body.id || '', 128);
  const enable = parseBoolean(body.enable, true);
  if (!id) {
    return sendJson(res, 400, { error: 'missing_id' });
  }

  const current = new Set(state.settings?.extensions || []);
  if (enable) current.add(id);
  else current.delete(id);
  const nextList = [...current];

  state.settings = { ...(state.settings || {}), extensions: nextList };
  await persistSettings(state);

  state.extensions = await loadExtensions({ list: nextList });

  return sendJson(res, 200, {
    enabled: nextList,
    active: (state.extensions?.active || []).map((ext) => ext.id),
  });
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return normalized === 'true' || normalized === 'on' || normalized === '1' || normalized === 'yes';
}
