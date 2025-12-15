import { POLICIES } from '../config.js';
import { getCitizen } from '../services/citizen.js';
import { getCirclePolicyState } from '../services/policy.js';
import { sendHtml } from '../utils/http.js';
import { renderPage } from '../views/templates.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const policy = getCirclePolicyState(state);
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount: state.discussions.length,
      citizenHandle: citizen?.handle,
      policyFlag: policy.enforcement === 'strict' ? 'Circle enforcement on' : 'Circle policy observing (no hard gate)',
      policyDetail: `Policy ${POLICIES.id} v${POLICIES.version} · Ledger entries ${policy.ledgerEntries} · Peers ${policy.peersKnown}`,
    },
    { wantsPartial, title: 'Representative Party' },
  );
  return sendHtml(res, html);
}
