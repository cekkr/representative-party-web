import { getCitizen } from '../services/citizen.js';
import { buildPolicyGates, getCirclePolicyState, getEffectivePolicy } from '../services/policy.js';
import { sendHtml } from '../utils/http.js';
import { renderPage } from '../views/templates.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const gateSummary = summarizeGateSnapshot(buildPolicyGates(state));
  const extensionsSummary = summarizeExtensions(state);
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount: state.discussions.length,
      petitionCount: state.petitions.length,
      groupCount: state.groups.length,
      citizenHandle: citizen?.handle,
      policyFlag: policy.enforcement === 'strict' ? 'Circle enforcement on' : 'Circle policy observing (no hard gate)',
      policyDetail: `Policy ${effective.id} v${effective.version} · Ledger entries ${policy.ledgerEntries} · Peers ${policy.peersKnown}`,
      circleName: effective.circleName,
      firstRunNote: effective.initialized ? '' : 'First installation mode: visit Admin to configure and persist Circle policies.',
      gateSummary,
      extensionsSummary,
    },
    { wantsPartial, title: 'Representative Party' },
  );
  return sendHtml(res, html);
}

function summarizeGateSnapshot(gates) {
  const describe = (label, gate) =>
    `${label} post:${gate.post.allowed ? 'allow' : 'block'} petition:${gate.petition.allowed ? 'allow' : 'block'} vote:${gate.vote.allowed ? 'allow' : 'block'}`;
  return [describe('guest', gates.guest), describe('citizen', gates.citizen), describe('delegate', gates.delegate)].join(' | ');
}

function summarizeExtensions(state) {
  const active = state.extensions?.active || [];
  if (!active.length) return 'Extensions: none';
  return `Extensions: ${active.map((ext) => ext.id).join(', ')}`;
}
