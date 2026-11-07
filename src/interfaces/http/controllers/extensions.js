import {
  installExtension,
  loadExtensions,
  listAvailableExtensions,
  uninstallExtension,
} from '../../../modules/extensions/registry.js';
import { persistSettings } from '../../../infra/persistence/storage.js';
import { sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { FORM_OUTCOME, isHtmlFormPost, setFlashNotice } from '../views/formOutcome.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { parseBoolean } from '../../../shared/utils/parse.js';
import { getPerson } from '../../../modules/identity/person.js';
import { sendAdminRequiredJson } from '../views/adminGate.js';
import { canAdministerProvider } from '../../../modules/identity/privileges.js';

export async function getExtensions({ req, res, state }) {
  const person = getPerson(req, state);
  if (!canAdministerProvider(person, state)) {
    return sendAdminRequiredJson({ res, person });
  }
  const available = await listAvailableExtensions(state);
  const active = (state.extensions?.active || []).map((ext) => ext.id);
  const enabled = state.settings?.extensions || [];
  return sendJson(res, 200, { available, active, enabled });
}

export async function toggleExtension({ req, res, state }) {
  const person = getPerson(req, state);
  if (!canAdministerProvider(person, state)) {
    return sendAdminRequiredJson({ res, person });
  }
  const body = await readRequestBody(req, { repeated: ['extensions'] });
  // The admin form is an ordinary HTML form: it returns to the Extensions section
  // with a notice whose tone follows the outcome. JSON clients keep the JSON contract.
  const htmlForm = isHtmlFormPost(req);
  const reply = (status, payload, code) => {
    if (!htmlForm) return sendJson(res, status, payload);
    setFlashNotice(res, 'extensions', code);
    return sendRedirect(res, '/admin#extensions');
  };
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
      const code = lifecycle.intent === 'uninstall'
        ? 'uninstalled'
        : result?.updated ? 'updated' : 'installed';
      return reply(200, {
        lifecycle: lifecycle.intent,
        result,
        available,
        enabled: state.settings?.extensions || [],
        active: (state.extensions?.active || []).map((ext) => ext.id),
      }, code);
    } catch (error) {
      return reply(extensionErrorStatus(error), {
        error: error.code || 'extension_lifecycle_failed',
        message: error.message,
      }, EXTENSION_ERROR_CODES[error?.code] || 'lifecycle-failed');
    }
  }

  // An HTML form with every box unticked posts no `extensions` pair at all; the
  // hidden marker says the list was submitted and is empty.
  const submitted = htmlForm && body.extensionsForm && body.extensions === undefined
    ? { ...body, extensions: [] }
    : body;
  const list = normalizeList(submitted, state.settings?.extensions || []);
  if (!list) {
    return reply(400, { error: 'missing_extensions' }, 'missing');
  }

  const available = await listAvailableExtensions(state);
  const availableById = new Map(available.map((entry) => [entry.id, entry]));
  const unknown = list.filter((id) => !availableById.has(id));
  if (unknown.length) {
    return reply(400, { error: 'unknown_extensions', extensions: unknown }, 'unknown');
  }
  const uninstalled = list.filter((id) => !availableById.get(id)?.installed);
  if (uninstalled.length) {
    return reply(409, { error: 'extensions_not_installed', extensions: uninstalled }, 'not-installed');
  }

  const nextList = [...new Set(list)];

  state.settings = { ...(state.settings || {}), extensions: nextList };
  await persistSettings(state);

  state.extensions = await loadExtensions({
    list: nextList,
    installations: state.settings?.extensionInstallations || [],
  });

  const active = (state.extensions?.active || []).map((ext) => ext.id);
  // Enabled is not active: an enabled hook that failed to load did not apply.
  const inactive = nextList.filter((id) => !active.includes(id));
  return reply(200, { enabled: nextList, active }, inactive.length ? 'saved-inactive' : 'saved');
}

const EXTENSION_ERROR_CODES = {
  extension_not_found: 'not-found',
  extension_unavailable: 'unavailable',
  invalid_extension_id: 'invalid',
};

// Fixed messages for the admin Extensions section, chosen by code only.
export const EXTENSION_NOTICES = Object.freeze({
  saved: { outcome: FORM_OUTCOME.APPLIED, message: 'Enabled extensions saved. Hook changes apply immediately.' },
  'saved-inactive': {
    outcome: FORM_OUTCOME.PARTIAL,
    message: 'Enabled extensions saved, but at least one enabled extension is not active. Check its status below.',
  },
  installed: { outcome: FORM_OUTCOME.APPLIED, message: 'Extension installed. Enable it to activate its hooks.' },
  updated: { outcome: FORM_OUTCOME.APPLIED, message: 'Extension updated to the discovered version.' },
  uninstalled: { outcome: FORM_OUTCOME.APPLIED, message: 'Extension uninstalled and its hooks disabled. Its source file was kept.' },
  missing: { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'No extension list was submitted, so nothing changed.' },
  unknown: { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'An extension in the list was not discovered, so nothing changed.' },
  'not-installed': { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'Install an extension before enabling it. Nothing changed.' },
  'not-found': { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'That extension was not found in the catalog. Nothing changed.' },
  unavailable: { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'That extension cannot be loaded, so it was not installed.' },
  invalid: { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'That extension id is not valid. Nothing changed.' },
  'lifecycle-failed': { outcome: FORM_OUTCOME.NOT_APPLIED, message: 'The extension change failed. Nothing was applied.' },
});

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
