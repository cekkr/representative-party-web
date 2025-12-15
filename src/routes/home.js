import { POLICIES } from '../config.js';
import { getCitizen } from '../services/citizen.js';
import { sendHtml } from '../utils/http.js';
import { renderPage } from '../views/templates.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount: state.discussions.length,
      citizenHandle: citizen?.handle,
      policyFlag: POLICIES.enforceCircle ? 'Circle enforcement on' : 'Circle policy open',
    },
    { wantsPartial, title: 'Representative Party' },
  );
  return sendHtml(res, html);
}
