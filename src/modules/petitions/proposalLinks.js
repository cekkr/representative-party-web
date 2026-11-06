import { isModuleEnabled } from '../circle/modules.js';
import { someVisibleEntries } from '../federation/replication.js';
import { resolveGroupScope } from '../groups/groupScope.js';
import { parsePage } from '../../shared/utils/pagination.js';

const STAGES = new Set(['draft', 'discussion', 'vote', 'closed']);

export function readProposalBrowse(params) {
  const stage = (params.get('stage') || '').toLowerCase();
  return {
    stage: stage === 'open' ? 'vote' : STAGES.has(stage) ? stage : '',
    page: parsePage(params.get('page')),
  };
}

export function proposalBrowseHref(groupId, browse = {}) {
  const query = new URLSearchParams();
  if (groupId) query.set('group', groupId);
  if (browse.stage) query.set('stage', browse.stage);
  if (browse.page > 1) query.set('page', browse.page);
  return query.size ? `/petitions?${query}` : '/petitions';
}

export function proposalHref(proposal, { view = '', stage, page } = {}) {
  const url = new URL(proposalBrowseHref(proposal.groupId, { stage, page }), 'http://local');
  url.searchParams.set('proposal', proposal.id);
  if (view && view !== 'overview') url.searchParams.set('view', view);
  return url.pathname + url.search;
}

export function resolveProposalScope(state, person, proposal) {
  return resolveGroupScope(state, person, proposal.groupId, { lane: 'petitions' });
}

export function canReadProposal(state, person, proposal) {
  return Boolean(proposal) && isModuleEnabled(state, 'petitions') &&
    someVisibleEntries([proposal], state) && resolveProposalScope(state, person, proposal).ok;
}
