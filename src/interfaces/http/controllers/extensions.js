import {
  installExtension,
  loadExtensions,
  listAvailableExtensions,
  uninstallExtension,
} from '../../../modules/extensions/registry.js';
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
  const lifecycle = normalizeLifecycle(body);
  if (lifecycle) {
    try {
      const result = lifecycle.intent === 'install'
        ? await installExtension(state, lifecycle.id)
        : uninstallExtension(state, lifecycle.id);
      await persistSettings(state);
      state.extensions = await loadExtensions({
        list: state.settings?.extensions || [],
        installations: state.settings?.extensionInstallations || [],
      });
      const available = await listAvailableExtensions(state);
      return sendJson(res, 200, {
        lifecycle: lifecycle.intent,
        result,
        available,
        enabled: state.settings?.extensions || [],
        active: (state.extensions?.active || []).map((ext) => ext.id),
      });
    } catch (error) {
      return sendJson(res, extensionErrorStatus(error), {
        error: error.code || 'extension_lifecycle_failed',
        message: error.message,
      });
    }
  }

  const list = normalizeList(body, state.settings?.extensions || []);
  if (!list) {
    return sendJson(res, 400, { error: 'missing_extensions' });
  }

  const available = await listAvailableExtensions(state);
  const availableById = new Map(available.map((entry) => [entry.id, entry]));
  const unknown = list.filter((id) => !availableById.has(id));
  if (unknown.length) {
    return sendJson(res, 400, { error: 'unknown_extensions', extensions: unknown });
  }
  const uninstalled = list.filter((id) => !availableById.get(id)?.installed);
  if (uninstalled.length) {
    return sendJson(res, 409, { error: 'extensions_not_installed', extensions: uninstalled });
  }

  const nextList = [...new Set(list)];

  state.settings = { ...(state.settings || {}), extensions: nextList };
  await persistSettings(state);

  state.extensions = await loadExtensions({
    list: nextList,
    installations: state.settings?.extensionInstallations || [],
  });

  return sendJson(res, 200, {
    enabled: nextList,
    active: (state.extensions?.active || []).map((ext) => ext.id),
  });
}

function normalizeList(body, current = []) {
  if (!body) return null;
  if (Array.isArray(body.extensions)) {
    return body.extensions.map(normalizeRequestedId).filter(Boolean);
  }
  if (body.extensions === '') return [];
  if (body.id) {
    const enable = parseBoolean(body.enable, true);
    const id = normalizeRequestedId(body.id);
    if (!id) return null;
    const next = new Set(current.map(normalizeRequestedId).filter(Boolean));
    if (enable) next.add(id);
    else next.delete(id);
    return [...next];
  }
  return null;
}

function normalizeLifecycle(body) {
  if (!body) return null;
  let intent = sanitizeText(body.intent, 24).toLowerCase();
  let id = sanitizeText(body.id, 128);
  const compact = sanitizeText(body.lifecycle, 160);
  if (compact) {
    const separator = compact.indexOf(':');
    if (separator > 0) {
      intent = compact.slice(0, separator).toLowerCase();
      id = compact.slice(separator + 1);
    }
  }
  if (!['install', 'uninstall'].includes(intent)) return null;
  return { intent, id };
}

function extensionErrorStatus(error) {
  if (error?.code === 'extension_not_found') return 404;
  if (error?.code === 'extension_unavailable') return 409;
  if (error?.code === 'invalid_extension_id') return 400;
  return 500;
}

function normalizeRequestedId(value) {
  return sanitizeText(value, 128).replace(/\.js$/i, '');
}
