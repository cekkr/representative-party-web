import { loadExtensions, listAvailableExtensions } from '../../../modules/extensions/registry.js';
import { persistSettings } from '../../../infra/persistence/storage.js';
import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { parseBoolean } from '../../../shared/utils/parse.js';

export async function getExtensions({ res, state }) {
  const available = await listAvailableExtensions(state);
  const active = (state.extensions?.active || []).map((ext) => ext.id);
  const enabled = state.settings?.extensions || [];
  return sendJson(res, 200, { available, active, enabled });
}

export async function toggleExtension({ req, res, state }) {
  const body = await readRequestBody(req);
  const list = normalizeList(body);
  if (!list) {
    return sendJson(res, 400, { error: 'missing_extensions' });
  }

  const nextList = list;

  state.settings = { ...(state.settings || {}), extensions: nextList };
  await persistSettings(state);

  state.extensions = await loadExtensions({ list: nextList });

  return sendJson(res, 200, {
    enabled: nextList,
    active: (state.extensions?.active || []).map((ext) => ext.id),
  });
}

function normalizeList(body) {
  if (!body) return null;
  if (Array.isArray(body.extensions)) {
    return body.extensions.map((value) => sanitizeText(value, 128)).filter(Boolean);
  }
  if (body.id) {
    const enable = parseBoolean(body.enable, true);
    const id = sanitizeText(body.id, 128);
    if (!id) return null;
    return enable ? [id] : [];
  }
  return null;
}
