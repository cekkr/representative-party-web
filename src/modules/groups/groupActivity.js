import { isModuleEnabled } from '../circle/modules.js';
import { filterVisibleEntries } from '../federation/replication.js';
import { findDiscussionRecord, isDiscussionPost } from '../discussion/discussionLinks.js';
import { canReadProposal } from '../petitions/proposalLinks.js';
import { listElections, pickWinner } from './groupElections.js';
import { canReadGroupLane } from './groupScope.js';

// A group's activity history: what happened in the group, newest first.
//
// It is derived from the durable records the group already owns (its creation and
// role entries, its elections, and the lane items and promotion trails that name
// it) rather than from the audit log, which is a bounded, federated summary and
// would silently drop old history. Each family keeps the gate of the view it comes
// from:
//
// - membership follows the roster: only members and managers see who joined;
// - decisions follow the Decisions view, which anyone may read; individual
//   ballots never appear, only that an election opened or closed and who won;
// - lane events require reading this group's lane, and a record that has since
//   moved somewhere the viewer cannot open keeps its event but withholds its title
//   and link, the same rule the inbox uses.

export const GROUP_ACTIVITY_FAMILIES = ['lanes', 'decisions', 'membership'];

export function readGroupActivityFamily(params) {
  const value = String(params?.get?.('kind') || '').trim().toLowerCase();
  return GROUP_ACTIVITY_FAMILIES.includes(value) ? value : '';
}

function validTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function actorOf(hash) {
  return hash && hash !== 'anonymous' ? hash : null;
}

// The group that held an item at a given time: the trail is replayed up to that
// moment, so an event is attributed to the lane it actually happened in.
function originGroupId(entry) {
  const trail = Array.isArray(entry?.promotions) ? entry.promotions : [];
  return trail.length ? trail[0].fromGroupId || null : entry?.groupId || null;
}

function groupAt(entry, at) {
  const trail = Array.isArray(entry?.promotions) ? entry.promotions : [];
  let current = originGroupId(entry);
  for (const step of trail) {
    if (validTime(step.at) && Date.parse(step.at) <= Date.parse(at)) current = step.toGroupId || null;
  }
  return current;
}

function touchesGroup(entry, groupId) {
  if (entry?.groupId === groupId || originGroupId(entry) === groupId) return true;
  return (entry?.promotions || []).some((step) => step.fromGroupId === groupId || step.toGroupId === groupId);
}

function findCreatorRole(group) {
  const created = Date.parse(group.createdAt || '');
  if (Number.isNaN(created)) return null;
  // createGroup writes the creator's admin role in the same call, so its join time
  // sits within a moment of the group's own.
  return (group.roles || []).find((entry) => entry.role === 'admin' && validTime(entry.joinedAt) &&
    Math.abs(Date.parse(entry.joinedAt) - created) < 2000) || null;
}

function laneEvents(entry, group, record, { createdType, extra = [] }) {
  const events = [];
  const push = (event) => {
    if (validTime(event.at)) events.push({ family: 'lanes', record, ...event });
  };
  if (originGroupId(entry) === group.id) {
    push({ type: createdType, at: entry.createdAt, actorHash: actorOf(entry.authorHash) });
  }
  for (const event of extra) {
    if (validTime(event.at) && groupAt(entry, event.at) === group.id) push(event);
  }
  for (const step of entry.promotions || []) {
    if (step.fromGroupId === group.id) {
      push({ type: 'moved_up', at: step.at, actorHash: actorOf(step.byHash), targetName: step.toGroupName || '' });
    } else if (step.toGroupId === group.id) {
      push({ type: 'moved_in', at: step.at, actorHash: actorOf(step.byHash), sourceName: step.fromGroupName || '' });
    }
  }
  for (const request of entry.promotionRequests || []) {
    if (!validTime(request.at) || groupAt(entry, request.at) !== group.id) continue;
    push({ type: 'promotion_requested', at: request.at, actorHash: actorOf(request.byHash), targetName: request.targetLabel || '' });
    // An approval is the move itself, which the trail already records.
    if (request.status === 'declined') {
      push({ type: 'promotion_declined', at: request.decidedAt, actorHash: actorOf(request.decidedByHash) });
    }
  }
  return events;
}

export function listGroupActivity(state, person, group, { canSeeRoster = false } = {}) {
  if (!group) return [];
  const events = [];

  const creator = findCreatorRole(group);
  if (validTime(group.createdAt)) {
    events.push({
      family: 'membership',
      type: 'group_created',
      at: group.createdAt,
      actorHash: canSeeRoster ? actorOf(creator?.hash) : null,
    });
  }
  if (canSeeRoster) {
    const members = new Set(group.members || []);
    for (const entry of group.roles || []) {
      if (entry === creator || !members.has(entry.hash) || !validTime(entry.joinedAt)) continue;
      events.push({ family: 'membership', type: 'member_joined', at: entry.joinedAt, actorHash: entry.hash });
    }
  }

  for (const election of listElections(state, group.id)) {
    const record = { kind: 'election', id: election.id, title: election.topic || 'general' };
    if (validTime(election.createdAt)) {
      events.push({ family: 'decisions', type: 'election_opened', at: election.createdAt, record });
    }
    if (election.status === 'closed' && validTime(election.closedAt)) {
      const winner = pickWinner(election, state);
      events.push({
        family: 'decisions',
        type: 'election_closed',
        at: election.closedAt,
        record,
        winnerHash: winner?.candidateHash || null,
        ballots: (election.votes || []).length,
      });
    }
  }

  if (canReadGroupLane(state, person, group)) {
    if (isModuleEnabled(state, 'discussion')) {
      const posts = filterVisibleEntries(state.discussions, state,
        (entry) => isDiscussionPost(entry) && touchesGroup(entry, group.id));
      for (const entry of posts) {
        const readable = Boolean(findDiscussionRecord(state, person, entry.id));
        const record = { kind: 'discussion', id: entry.id, groupId: entry.groupId || null, title: entry.content || '', readable };
        events.push(...laneEvents(entry, group, record, { createdType: 'discussion_posted' }));
      }
    }
    if (isModuleEnabled(state, 'petitions')) {
      const proposals = filterVisibleEntries(state.petitions, state, (entry) => touchesGroup(entry, group.id));
      for (const entry of proposals) {
        const readable = canReadProposal(state, person, entry);
        const record = { kind: 'proposal', id: entry.id, groupId: entry.groupId || null, title: entry.title || '', readable };
        events.push(...laneEvents(entry, group, record, {
          createdType: 'proposal_created',
          extra: [
            { type: 'proposal_discussion_opened', at: entry.discussionOpenedAt },
            // A quorum freeze is stamped with the last signer, who did not open
            // voting, so the opening carries no actor.
            { type: 'proposal_voting_opened', at: entry.freeze?.frozenAt },
            { type: 'proposal_voting_closed', at: entry.closedAt, actorHash: actorOf(entry.closedBy) },
          ],
        }));
      }
    }
  }

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function countGroupActivity(events = []) {
  const counts = { '': events.length };
  for (const family of GROUP_ACTIVITY_FAMILIES) counts[family] = 0;
  for (const event of events) counts[event.family] = (counts[event.family] || 0) + 1;
  return counts;
}
