import { getPerson } from '../../identity/person.js';
import { buildPolicyGates, getCirclePolicyState, getEffectivePolicy } from '../../circle/policy.js';
import { countVisibleEntries } from '../../federation/replication.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { sendHtml, sendRedirect } from '../../../shared/utils/http.js';
import { renderSocialFeed } from '../../social/http/social.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { getActorLabels } from '../../../interfaces/http/views/actorLabel.js';

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
  const moduleSettings = resolveModuleSettings(state);
  const socialLaneSummary = summarizeLane(moduleSettings, ['social', 'topicGardener']);
  const governanceLaneSummary = summarizeLane(moduleSettings, ['petitions', 'votes', 'delegation', 'groups']);
  const federationLaneSummary = summarizeLane(moduleSettings, ['federation']);
  const socialLaneStatus = describeLaneStatus(moduleSettings, ['social', 'topicGardener']);
  const governanceLaneStatus = describeLaneStatus(moduleSettings, ['petitions', 'votes', 'delegation', 'groups']);
  const federationLaneStatus = describeLaneStatus(moduleSettings, ['federation']);
  const discussionCount = countVisibleEntries(state.discussions, state);
  const petitionCount = countVisibleEntries(state.petitions, state);
  const groupCount = countVisibleEntries(state.groups, state);
  const socialEnabled = isModuleEnabled(state, 'social');
  const petitionsEnabled = isModuleEnabled(state, 'petitions');
  const federationEnabled = isModuleEnabled(state, 'federation');
  const socialLink = socialEnabled ? '<a class="cta" href="/social/feed" data-partial>Open social feed</a>' : '';
  const proposalsLink = petitionsEnabled ? '<a class="ghost" href="/petitions" data-partial>Open proposals</a>' : '';
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
      socialLaneSummary,
      governanceLaneSummary,
      federationLaneSummary,
      socialLaneStatus,
      governanceLaneStatus,
      federationLaneStatus,
      socialLink,
      proposalsLink,
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

function summarizeLane(moduleSettings, keys) {
  const enabled = listEnabledModuleKeys(moduleSettings, keys);
  return enabled.length ? enabled.join(', ') : 'none';
}

function describeLaneStatus(moduleSettings, keys) {
  const enabled = listEnabledModuleKeys(moduleSettings, keys);
  if (!enabled.length) return 'No optional modules enabled in this lane yet.';
  return `Enabled now: ${enabled.join(', ')}.`;
}

function listEnabledModuleKeys(moduleSettings, keys = []) {
  return keys.filter((key) => moduleSettings[key] !== false);
}
