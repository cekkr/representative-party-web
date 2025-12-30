import { getPerson } from '../../modules/identity/person.js';
import { buildPolicyGates, getCirclePolicyState, getEffectivePolicy } from '../../modules/circle/policy.js';
import { filterVisibleEntries } from '../../modules/federation/replication.js';
import { isModuleEnabled } from '../../modules/circle/modules.js';
import { sendHtml } from '../../shared/utils/http.js';
import { renderPage } from '../views/templates.js';
import { deriveStatusMeta, renderStatusStrip } from '../views/status.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const gateSummary = summarizeGateSnapshot(buildPolicyGates(state));
  const extensionsSummary = summarizeExtensions(state);
  const visibleDiscussions = filterVisibleEntries(state.discussions, state);
  const visiblePetitions = filterVisibleEntries(state.petitions, state);
  const visibleGroups = filterVisibleEntries(state.groups, state);
  const federationEnabled = isModuleEnabled(state, 'federation');
  const ledgerLink = federationEnabled
    ? '<a class="ghost" href="/circle/ledger" target="_blank" rel="noreferrer">Ledger feed</a>'
    : '';
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount: visibleDiscussions.length,
      petitionCount: visiblePetitions.length,
      groupCount: visibleGroups.length,
      personHandle: person?.handle,
      policyFlag: policy.enforcement === 'strict' ? 'Circle enforcement on' : 'Circle policy observing (no hard gate)',
      policyDetail: `Policy ${effective.id} v${effective.version} · Ledger entries ${policy.ledgerEntries} · Peers ${policy.peersKnown}`,
      circleName: effective.circleName,
      firstRunNote: effective.initialized ? '' : 'First installation mode: visit Admin to configure and persist Circle policies.',
      gateSummary,
      extensionsSummary,
      ledgerLink,
      statusStrip: renderStatusStrip(deriveStatusMeta(state)),
    },
    { wantsPartial, title: 'Representative Party', state },
  );
  return sendHtml(res, html);
}

function summarizeGateSnapshot(gates) {
  const describe = (label, gate) =>
    `${label} post:${gate.post.allowed ? 'allow' : 'block'} petition:${gate.petition.allowed ? 'allow' : 'block'} vote:${gate.vote.allowed ? 'allow' : 'block'}`;
  return [describe('guest', gates.guest), describe('person', gates.person), describe('delegate', gates.delegate)].join(' | ');
}

function summarizeExtensions(state) {
  const active = state.extensions?.active || [];
  if (!active.length) return 'Extensions: none';
  return `Extensions: ${active.map((ext) => ext.id).join(', ')}`;
}
