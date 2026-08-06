import { findGroupById, isGroupAdmin } from './groups.js';
import { getGroupPolicy } from './groupPolicy.js';
import { getParentGroup } from './groupTree.js';
import { evaluateAction } from '../circle/policy.js';

// Promoting an item moves it one level up the group tree: a branch's discussion or proposal
// becomes the parent group's, and a top-level group's becomes the Circle's own.
//
// This is a move, not a copy. Duplicating would fork the comment thread, the signatures and
// the votes attached to the item, leaving two divergent records of one decision; keeping a
// single record with a promotion trail preserves everything that already hangs off its id.
// Promotion only ever goes up — an item cannot be pushed down into a group its participants
// never joined.

export const PROMOTABLE_KINDS = new Set(['discussion', 'petition']);

// Where an item currently scoped to `groupId` would land. `null` means Circle level.
export function resolvePromotionTarget(state, groupId) {
  const group = findGroupById(state, groupId);
  if (!group) return { ok: false, error: 'group_not_found', message: 'Group not found.' };
  const parent = getParentGroup(state, group);
  if (!parent) {
    return { ok: true, group, target: null, targetLabel: 'the whole Circle', targetId: null };
  }
  return { ok: true, group, target: parent, targetLabel: parent.name || 'the parent group', targetId: parent.id };
}

// A group admin owns what leaves their group; a Circle moderator can also act, because they
// carry moderation accountability for the surface the item is being promoted onto.
export function canPromote(state, person, group) {
  if (!person?.pidHash || !group) return false;
  if (isGroupAdmin(group, person.pidHash)) return true;
  return evaluateAction(state, person, 'moderate').allowed;
}

// Refusals carry the resolved group/target for context, but `resolved` is itself an ok:true
// result — spreading it after the verdict would overwrite the refusal and open the gate.
// Building the shape here keeps `ok: false` authoritative no matter what is attached.
function refuse(error, message, resolved = {}) {
  const { ok: _ignored, ...context } = resolved;
  return { ...context, ok: false, error, message };
}

// Check every precondition without mutating, so a caller can render an accurate control
// (or an accurate refusal) before anyone submits.
export function evaluatePromotion(state, person, { kind, entry } = {}) {
  if (!PROMOTABLE_KINDS.has(kind)) {
    return { ok: false, error: 'not_promotable', message: 'This item cannot be promoted.' };
  }
  if (!entry) {
    return { ok: false, error: 'entry_not_found', message: 'Item not found.' };
  }
  if (!entry.groupId) {
    return { ok: false, error: 'already_top_level', message: 'This item is already at Circle level.' };
  }
  const resolved = resolvePromotionTarget(state, entry.groupId);
  if (!resolved.ok) return resolved;
  if (!canPromote(state, person, resolved.group)) {
    return refuse(
      'group_admin_required',
      'Group admin or Circle moderator required to promote this item.',
      resolved,
    );
  }
  // Promoting into a parent whose matching lane is switched off would drop the item onto a
  // surface nobody in that group can reach.
  const lane = kind === 'petition' ? 'petitions' : 'discussion';
  if (resolved.target) {
    const parentPolicy = getGroupPolicy(state, resolved.target.id);
    if (!parentPolicy.lanes?.[lane]) {
      return refuse(
        'parent_lane_disabled',
        `${resolved.target.name || 'The parent group'} has not enabled its internal ${lane === 'petitions' ? 'proposals' : 'discussion'} lane.`,
        resolved,
      );
    }
  }
  return { ok: true, ...resolved, lane };
}

// Apply the move and stamp the trail. Persistence is the caller's job, so the controller can
// use the right per-domain persist function.
export function applyPromotion(state, person, { kind, entry }) {
  const decision = evaluatePromotion(state, person, { kind, entry });
  if (!decision.ok) return decision;

  const from = entry.groupId;
  const to = decision.targetId;
  const trail = Array.isArray(entry.promotions) ? entry.promotions : [];
  entry.promotions = [
    ...trail,
    {
      at: new Date().toISOString(),
      fromGroupId: from,
      fromGroupName: decision.group?.name || '',
      toGroupId: to,
      toGroupName: decision.target?.name || '',
      byHash: person?.pidHash || null,
    },
  ].slice(-10);
  entry.groupId = to;

  return { ...decision, ok: true, fromGroupId: from, toGroupId: to, entry };
}

export function describePromotionTrail(entry) {
  const trail = Array.isArray(entry?.promotions) ? entry.promotions : [];
  if (!trail.length) return '';
  const last = trail[trail.length - 1];
  const from = last.fromGroupName || 'a group';
  const to = last.toGroupName || 'the Circle';
  return `Promoted from ${from} to ${to}`;
}
