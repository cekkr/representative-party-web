import { canAdministerProvider, isAdminBootstrapOpen } from '../../../modules/identity/privileges.js';
import { sendHtml, sendJson } from '../../../shared/utils/http.js';
import { renderPage } from './templates.js';

export { canAdministerProvider, isAdminBootstrapOpen };

function adminNote(person) {
  if (!person) return 'This session is not verified. Sign in with an admin session to continue.';
  if (person.banned) return 'This session is banned and cannot administer the provider.';
  return `This session has the "${person.role || 'user'}" role. Provider administration requires an admin session.`;
}

export async function renderAdminRequired({ res, state, wantsPartial, person }) {
  const html = await renderPage(
    'admin-required',
    { adminNote: adminNote(person), person },
    { wantsPartial, title: 'Admin access required', state },
  );
  return sendHtml(res, html, {}, 403);
}

export function sendAdminRequiredJson({ res, person }) {
  return sendJson(res, 403, {
    error: 'admin_required',
    message: adminNote(person),
  });
}
