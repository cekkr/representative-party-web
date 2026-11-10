import { isModuleEnabled } from '../circle/modules.js';
import { someVisibleEntries } from '../federation/replication.js';
import { resolveGroupScope } from '../groups/groupScope.js';
import { parsePage } from '../../shared/utils/pagination.js';
import { listCommentStances } from './commentStance.js';

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

// A Discussion filter narrows which notes show; it is a reading choice, never a
// write target, so only the Discussion view carries it.
export function readProposalStance(params) {
  const stance = String(params.get('stance') || '').trim().toLowerCase();
  return listCommentStances().some((entry) => entry.value === stance) ? stance : '';
}

export function proposalHref(proposal, { view = '', stage, page, stance = '' } = {}) {
  const url = new URL(proposalBrowseHref(proposal.groupId, { stage, page }), 'http://local');
  url.searchParams.set('proposal', proposal.id);
  if (view && view !== 'overview') url.searchParams.set('view', view);
  if (view === 'discussion' && stance) url.searchParams.set('stance', stance);
  return url.pathname + url.search;
}

export function resolveProposalScope(state, person, proposal) {
  return resolveGroupScope(state, person, proposal.groupId, { lane: 'petitions' });
}

export function canReadProposal(state, person, proposal) {
  return Boolean(proposal) && isModuleEnabled(state, 'petitions') &&
    someVisibleEntries([proposal], state) && resolveProposalScope(state, person, proposal).ok;
}
