import { getCitizen } from '../services/citizen.js';
import { getCirclePolicyState, getEffectivePolicy } from '../services/policy.js';
import { sendHtml } from '../utils/http.js';
import { renderPage } from '../views/templates.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount: state.discussions.length,
      citizenHandle: citizen?.handle,
      policyFlag: policy.enforcement === 'strict' ? 'Circle enforcement on' : 'Circle policy observing (no hard gate)',
      policyDetail: `Policy ${effective.id} v${effective.version} · Ledger entries ${policy.ledgerEntries} · Peers ${policy.peersKnown}`,
      circleName: effective.circleName,
      firstRunNote: effective.initialized ? '' : 'First installation mode: visit Admin to configure and persist Circle policies.',
    },
    { wantsPartial, title: 'Representative Party' },
  );
  return sendHtml(res, html);
}
