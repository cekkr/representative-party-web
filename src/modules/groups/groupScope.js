import { findGroupById, isGroupMember } from './groups.js';
import { getGroupPolicy } from './groupPolicy.js';
import { evaluateAction } from '../circle/policy.js';

// Group-internal lanes reuse the site's own discussion and petition surfaces rather than
// duplicating them: an entry simply carries a `groupId`, and these helpers decide what a
// given reader is allowed to see.
//
// The rule that makes a lane "internal" is subtraction, not a separate store: an entry with
// a `groupId` is *excluded* from the site feed and included only when that group is the
// requested scope. Without the exclusion a group's working notes would surface in the main
// feed, which is the opposite of what an optional internal lane is for.

export const SITE_SCOPE = null;

export function readGroupScope(source) {
  const raw = typeof source === 'string' ? source : source?.get?.('group') || '';
  const value = String(raw || '').trim();
  return value ? value.slice(0, 80) : SITE_SCOPE;
}

// Resolve a requested scope into something a controller can act on, with the reason a scope
// was refused so the surface can say why instead of rendering an empty list.
export function resolveGroupScope(state, person, groupId, { lane } = {}) {
  if (!groupId) return { ok: true, groupId: SITE_SCOPE, group: null, scoped: false };
  const group = findGroupById(state, groupId);
  if (!group) {
    return { ok: false, error: 'group_not_found', message: 'Group not found.' };
  }
  const policy = getGroupPolicy(state, group.id);
  if (lane && !policy.lanes?.[lane]) {
    return {
      ok: false,
      error: 'lane_disabled',
      message: `${group.name || 'This group'} has not enabled its internal ${lane === 'petitions' ? 'proposals' : 'discussion'} lane.`,
      group,
    };
  }
  if (!canReadGroupLane(state, person, group)) {
    return {
      ok: false,
      error: 'group_membership_required',
      message: `${group.name || 'This group'} keeps this lane internal to its members.`,
      group,
    };
  }
  return { ok: true, groupId: group.id, group, scoped: true, policy };
}

export function canReadGroupLane(state, person, group) {
  if (!group) return true;
  const policy = getGroupPolicy(state, group.id);
  if (policy.lanesVisibility === 'public') return true;
  if (!person?.pidHash) return false;
  if (isGroupMember(group, person.pidHash)) return true;
  // Circle moderators can read internal lanes because they are accountable for moderating
  // them. This goes through the shared policy gate rather than re-deriving role rules here.
  return evaluateAction(state, person, 'moderate').allowed;
}

export function canPostToGroupLane(state, person, group, lane) {
  if (!group) return true;
  if (!person?.pidHash) return false;
  const policy = getGroupPolicy(state, group.id);
  if (!policy.lanes?.[lane]) return false;
  return isGroupMember(group, person.pidHash);
}

// Predicate for a list query. At site scope this drops every group-scoped entry; at group
// scope it keeps only that group's.
export function matchesGroupScope(entry, groupId) {
  const entryGroup = entry?.groupId || null;
  return groupId ? entryGroup === groupId : !entryGroup;
}

// Groups whose internal lane this person may currently read, for lane pickers and nav.
export function listReadableGroupLanes(state, person, lane) {
  return (state?.groups || [])
    .filter((group) => getGroupPolicy(state, group.id).lanes?.[lane])
    .filter((group) => canReadGroupLane(state, person, group));
}

export function listPostableGroupLanes(state, person, lane) {
  return (state?.groups || []).filter((group) => canPostToGroupLane(state, person, group, lane));
}
