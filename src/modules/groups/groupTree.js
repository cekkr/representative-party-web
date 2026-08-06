// Group nesting. A group may be a branch of another group — a party with a topic-focused
// think tank, a divergent-philosophy wing, or an alternative branch — so structure can grow
// without every cohort becoming a peer of every other.
//
// Nesting is structural, not authority: a subgroup is not governed by its parent, does not
// inherit its membership, and its cachets are its own. What nesting buys is discovery
// (branches are listed under their parent), specificity (a branch's delegate cachet is a
// narrower expression than the parent's, so it wins a tie), and a defined "upper level" for
// promoting a discussion or proposal.

export const MAX_GROUP_DEPTH = 4;

export function getParentGroup(state, group) {
  if (!group?.parentId) return null;
  return (state?.groups || []).find((entry) => entry.id === group.parentId) || null;
}

// Ancestors nearest-first. Bounded by MAX_GROUP_DEPTH and a seen-set so a corrupted or
// hand-edited store cannot spin here.
export function listAncestorGroups(state, group) {
  const byId = new Map((state?.groups || []).map((entry) => [entry.id, entry]));
  const ancestors = [];
  const seen = new Set(group?.id ? [group.id] : []);
  let current = group?.parentId ? byId.get(group.parentId) : null;
  while (current && !seen.has(current.id) && ancestors.length < MAX_GROUP_DEPTH) {
    ancestors.push(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : null;
  }
  return ancestors;
}

export function getGroupDepth(state, group) {
  return listAncestorGroups(state, group).length;
}

export function listChildGroups(state, groupId) {
  if (!groupId) return [];
  return (state?.groups || []).filter((entry) => entry.parentId === groupId);
}

// Every group beneath `groupId`, breadth-first. Used to decide where a promoted item can go
// and to stop a group being re-parented under its own branch.
export function listDescendantGroups(state, groupId) {
  const out = [];
  const queue = listChildGroups(state, groupId);
  const seen = new Set(queue.map((entry) => entry.id));
  while (queue.length) {
    const current = queue.shift();
    out.push(current);
    for (const child of listChildGroups(state, current.id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child);
    }
  }
  return out;
}

// Validate a proposed parent for `groupId` (pass null groupId when creating).
export function validateParent(state, { groupId = null, parentId = null } = {}) {
  if (!parentId) return { ok: true, parentId: null };
  const parent = (state?.groups || []).find((entry) => entry.id === parentId);
  if (!parent) return { ok: false, error: 'parent_not_found', message: 'Parent group not found.' };
  if (groupId && parentId === groupId) {
    return { ok: false, error: 'parent_self', message: 'A group cannot be its own parent.' };
  }
  if (groupId && listDescendantGroups(state, groupId).some((entry) => entry.id === parentId)) {
    return { ok: false, error: 'parent_cycle', message: 'That group is already a branch of this one.' };
  }
  if (getGroupDepth(state, parent) + 1 >= MAX_GROUP_DEPTH) {
    return {
      ok: false,
      error: 'parent_too_deep',
      message: `Groups nest at most ${MAX_GROUP_DEPTH} levels deep.`,
    };
  }
  return { ok: true, parentId, parent };
}

// Flatten every group into depth-ordered rows (parents immediately followed by their
// branches), so a list can render the hierarchy without recursion in the view.
export function buildGroupTree(groups = []) {
  const byParent = new Map();
  const ids = new Set(groups.map((group) => group.id));
  for (const group of groups) {
    // A group whose parent is not in the visible set renders as a root rather than vanishing.
    const key = group.parentId && ids.has(group.parentId) ? group.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(group);
  }

  const rows = [];
  const seen = new Set();
  const walk = (parentKey, depth) => {
    if (depth > MAX_GROUP_DEPTH) return;
    for (const group of byParent.get(parentKey) || []) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      rows.push({ group, depth });
      walk(group.id, depth + 1);
    }
  };
  walk(null, 0);

  // Anything left behind by a cycle still gets rendered, flat, rather than disappearing.
  for (const group of groups) {
    if (!seen.has(group.id)) rows.push({ group, depth: 0 });
  }
  return rows;
}

// A readable "Branch of X / Y" trail for a group card.
export function formatGroupLineage(state, group, { separator = ' / ' } = {}) {
  const ancestors = listAncestorGroups(state, group);
  if (!ancestors.length) return '';
  return ancestors
    .slice()
    .reverse()
    .map((entry) => entry.name || 'Group')
    .join(separator);
}
