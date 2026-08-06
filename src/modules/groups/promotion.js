import { canModerateGroupLane, findGroupById, isGroupMember } from './groups.js';
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

// A group admin or lane moderator owns what leaves their group; a Circle moderator can also
// act, because they carry moderation accountability for the surface it is being promoted onto.
export function canPromote(state, person, group) {
  if (!person?.pidHash || !group) return false;
  if (canModerateGroupLane(group, person.pidHash)) return true;
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

// ---------------------------------------------------------------------------
// Promotion requests
//
// Promotion is an admin/lane-moderator action, which left an ordinary member who thinks a
// branch discussion belongs at the parent level with no move to make. A request gives them
// one without handing them the decision: it is visible, auditable, and declinable with a
// reason — the same soft-power shape the rest of the product uses, rather than either a
// silent dead end or a second way to actually move the item.

export function getOpenPromotionRequest(entry) {
  return (entry?.promotionRequests || []).find((request) => request.status === 'open') || null;
}

export function listPromotionRequests(entry) {
  return Array.isArray(entry?.promotionRequests) ? entry.promotionRequests : [];
}

// Who may ask: any member of the group the item currently sits in, except someone who can
// already promote it themselves (for them the request would be a detour around their own
// button) and except when a request is already open.
export function evaluatePromotionRequest(state, person, { kind, entry } = {}) {
  if (!PROMOTABLE_KINDS.has(kind)) {
    return { ok: false, error: 'not_promotable', message: 'This item cannot be promoted.' };
  }
  if (!entry) return { ok: false, error: 'entry_not_found', message: 'Item not found.' };
  if (!entry.groupId) {
    return { ok: false, error: 'already_top_level', message: 'This item is already at Circle level.' };
  }
  if (!person?.pidHash) {
    return { ok: false, error: 'verification_required', message: 'Login to request a promotion.' };
  }
  const resolved = resolvePromotionTarget(state, entry.groupId);
  if (!resolved.ok) return resolved;
  if (!isGroupMember(resolved.group, person.pidHash)) {
    return refuse('group_membership_required', 'Join the group to request a promotion.', resolved);
  }
  if (canPromote(state, person, resolved.group)) {
    return refuse('can_promote_directly', 'You can promote this item yourself.', resolved);
  }
  if (getOpenPromotionRequest(entry)) {
    return refuse('request_already_open', 'A promotion request is already open for this item.', resolved);
  }
  return { ok: true, ...resolved };
}

export function applyPromotionRequest(state, person, { kind, entry, note = '' }) {
  const decision = evaluatePromotionRequest(state, person, { kind, entry });
  if (!decision.ok) return decision;
  const request = {
    id: `${entry.id}-${Date.now()}`,
    at: new Date().toISOString(),
    byHash: person.pidHash,
    note: String(note || '').slice(0, 240),
    status: 'open',
    targetGroupId: decision.targetId,
    targetLabel: decision.targetLabel,
  };
  entry.promotionRequests = [...listPromotionRequests(entry), request].slice(-10);
  return { ...decision, ok: true, request };
}

// Who may decide: exactly who may promote. Approving performs the move; declining records
// the reason so the asker learns something rather than watching a request evaporate.
export function evaluatePromotionDecision(state, person, { kind, entry } = {}) {
  if (!entry) return { ok: false, error: 'entry_not_found', message: 'Item not found.' };
  const request = getOpenPromotionRequest(entry);
  if (!request) {
    return { ok: false, error: 'no_open_request', message: 'No promotion request is open for this item.' };
  }
  if (!entry.groupId) {
    return { ok: false, error: 'already_top_level', message: 'This item is already at Circle level.' };
  }
  const resolved = resolvePromotionTarget(state, entry.groupId);
  if (!resolved.ok) return resolved;
  if (!canPromote(state, person, resolved.group)) {
    return refuse(
      'group_admin_required',
      'Group admin, lane moderator or Circle moderator required to decide this request.',
      resolved,
    );
  }
  return { ok: true, ...resolved, request };
}

export function applyPromotionDecision(state, person, { kind, entry, decision: verdict, reason = '' }) {
  const decision = evaluatePromotionDecision(state, person, { kind, entry });
  if (!decision.ok) return decision;

  const request = decision.request;
  request.decidedAt = new Date().toISOString();
  request.decidedByHash = person?.pidHash || null;
  request.reason = String(reason || '').slice(0, 240);

  if (verdict !== 'approve') {
    request.status = 'declined';
    return { ...decision, ok: true, approved: false, request };
  }

  const promoted = applyPromotion(state, person, { kind, entry });
  if (!promoted.ok) {
    // The request stays open: the blocker (a closed parent lane, say) is fixable, and
    // silently marking it approved would lose the ask.
    delete request.decidedAt;
    delete request.decidedByHash;
    return promoted;
  }
  request.status = 'approved';
  return { ...promoted, ok: true, approved: true, request };
}

export function describePromotionTrail(entry) {
  const trail = Array.isArray(entry?.promotions) ? entry.promotions : [];
  if (!trail.length) return '';
  const last = trail[trail.length - 1];
  const from = last.fromGroupName || 'a group';
  const to = last.toGroupName || 'the Circle';
  return `Promoted from ${from} to ${to}`;
}
