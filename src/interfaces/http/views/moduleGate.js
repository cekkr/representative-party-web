import { getModuleDefinition } from '../../../modules/circle/modules.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { renderPage } from './templates.js';

export async function renderModuleDisabled({ res, state, wantsPartial, moduleKey }) {
  const definition = getModuleDefinition(moduleKey);
  const moduleName = definition?.label || moduleKey;
  const moduleNote = definition?.description
    ? `${definition.description} This module is disabled in admin settings.`
    : 'This module is disabled in admin settings and cannot be accessed right now.';
  const html = await renderPage(
    'module-disabled',
    { moduleKey, moduleName, moduleNote },
    { wantsPartial, title: `${moduleName} disabled`, state },
  );
  return sendHtml(res, html, {}, 403);
}

export function sendModuleDisabledJson({ res, moduleKey }) {
  const definition = getModuleDefinition(moduleKey);
  const moduleName = definition?.label || moduleKey;
  return sendJson(res, 403, {
    error: 'module_disabled',
    module: moduleKey,
    message: `${moduleName} is disabled in admin settings.`,
  });
}
