import { getPerson } from '../../../modules/identity/person.js';
import { buildPolicyGates, getCirclePolicyState, getEffectivePolicy } from '../../../modules/circle/policy.js';
import { countVisibleEntries } from '../../../modules/federation/replication.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendHtml, sendRedirect } from '../../../shared/utils/http.js';
import { renderSocialFeed } from './social.js';
import { renderPage } from '../views/templates.js';
import { getActorLabels } from '../views/actorLabel.js';

export async function renderHome({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  if (person && isModuleEnabled(state, 'social')) {
    if (wantsPartial) {
      const url = new URL('/social/feed', `http://${req.headers.host}`);
      return renderSocialFeed({ req, res, state, wantsPartial, url });
    }
    return sendRedirect(res, '/social/feed');
  }
  const policy = getCirclePolicyState(state);
  const effective = getEffectivePolicy(state);
  const actorLabels = getActorLabels(state);
  const gateSummary = summarizeGateSnapshot(buildPolicyGates(state), actorLabels);
  const extensionsSummary = summarizeExtensions(state);
  const discussionCount = countVisibleEntries(state.discussions, state);
  const petitionCount = countVisibleEntries(state.petitions, state);
  const groupCount = countVisibleEntries(state.groups, state);
  const federationEnabled = isModuleEnabled(state, 'federation');
  const ledgerLink = federationEnabled
    ? '<a class="ghost" href="/circle/ledger" target="_blank" rel="noreferrer">Ledger feed</a>'
    : '';
  const html = await renderPage(
    'home',
    {
      ledgerSize: state.uniquenessLedger.size,
      actorCount: state.actors.size,
      discussionCount,
      petitionCount,
      groupCount,
      person,
      personHandle: person?.handle,
      roleLabel: person?.role || 'guest',
      policyFlag: policy.enforcement === 'strict' ? 'Circle enforcement on' : 'Circle policy observing (no hard gate)',
      policyDetail: `Policy ${effective.id} v${effective.version} · Ledger entries ${policy.ledgerEntries} · Peers ${policy.peersKnown}`,
      circleName: effective.circleName,
      firstRunNote: effective.initialized ? '' : 'First installation mode: visit Admin to run the installation wizard and persist Circle policies.',
      gateSummary,
      extensionsSummary,
      ledgerLink,
    },
    { wantsPartial, title: 'Representative Party', state },
  );
  return sendHtml(res, html);
}

function summarizeGateSnapshot(gates, actorLabels) {
  const actorLabel = actorLabels?.actorLabel || 'person';
  const actorGate = gates[actorLabel] || gates.person;
  const describe = (label, gate) =>
    `${label} post:${gate.post.allowed ? 'allow' : 'block'} petition:${gate.petition.allowed ? 'allow' : 'block'} vote:${gate.vote.allowed ? 'allow' : 'block'}`;
  return [describe('guest', gates.guest), describe(actorLabel, actorGate), describe('delegate', gates.delegate)].join(' | ');
}

function summarizeExtensions(state) {
  const active = state.extensions?.active || [];
  if (!active.length) return 'Extensions: none';
  return `Extensions: ${active.map((ext) => ext.id).join(', ')}`;
}
