import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_GROUP_DEPTH,
  buildGroupTree,
  formatGroupLineage,
  getGroupDepth,
  listAncestorGroups,
  listDescendantGroups,
  validateParent,
} from '../src/modules/groups/groupTree.js';
import {
  canPostToGroupLane,
  canReadGroupLane,
  matchesGroupScope,
  resolveGroupScope,
} from '../src/modules/groups/groupScope.js';
import { applyPromotion, evaluatePromotion, resolvePromotionTarget } from '../src/modules/groups/promotion.js';
import { buildCategoryDirectory } from '../src/modules/groups/categoryDirectory.js';
import { recommendDelegationForPerson } from '../src/modules/groups/groups.js';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../src/infra/persistence/migrations.js';

const dataConfig = { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false };

// A party with a think-tank branch and a divergent wing, as the UX notes describe.
function partyState(overrides = {}) {
  return {
    dataConfig,
    settings: {},
    groups: [
      { id: 'party', name: 'Rete Civica', parentId: null, members: ['ada', 'bruno'], roles: [{ hash: 'ada', role: 'admin' }], delegates: [], topics: ['Energy'] },
      { id: 'think-tank', name: 'Energy Think Tank', parentId: 'party', members: ['bruno'], roles: [{ hash: 'bruno', role: 'admin' }], delegates: [], topics: ['Energy / Solar'] },
      { id: 'wing', name: 'Alternative Wing', parentId: 'party', members: ['ada'], roles: [], delegates: [], topics: [] },
    ],
    groupPolicies: [],
    groupElections: [],
    discussions: [],
    petitions: [],
    sessions: [],
    ...overrides,
  };
}

function withPolicy(state, groupId, policy) {
  state.groupPolicies = [
    ...state.groupPolicies.filter((entry) => entry.groupId !== groupId),
    { groupId, electionMode: 'priority', conflictRule: 'highest_priority', ...policy },
  ];
  return state;
}

test('a group can be a branch of another and reports its lineage', () => {
  const state = partyState();
  const tank = state.groups[1];
  assert.equal(getGroupDepth(state, tank), 1);
  assert.deepEqual(listAncestorGroups(state, tank).map((g) => g.id), ['party']);
  assert.equal(formatGroupLineage(state, tank), 'Rete Civica');
  assert.deepEqual(listDescendantGroups(state, 'party').map((g) => g.id), ['think-tank', 'wing']);
});

test('the group tree renders parents immediately followed by their branches', () => {
  const rows = buildGroupTree(partyState().groups);
  assert.deepEqual(
    rows.map((row) => [row.group.id, row.depth]),
    [['party', 0], ['think-tank', 1], ['wing', 1]],
  );
});

test('a group whose parent is not visible still renders, as a root', () => {
  const rows = buildGroupTree([{ id: 'orphan', name: 'Orphan', parentId: 'missing' }]);
  assert.deepEqual(rows.map((row) => row.group.id), ['orphan']);
});

test('parent validation rejects self-reference, cycles, and excess depth', () => {
  const state = partyState();
  assert.equal(validateParent(state, { groupId: 'party', parentId: 'party' }).error, 'parent_self');
  assert.equal(
    validateParent(state, { groupId: 'party', parentId: 'think-tank' }).error,
    'parent_cycle',
    'a group cannot be re-parented under its own branch',
  );
  assert.equal(validateParent(state, { parentId: 'nope' }).error, 'parent_not_found');
  assert.equal(validateParent(state, { parentId: 'party' }).ok, true);

  // Build a chain to the depth cap and confirm the next level is refused.
  const deep = partyState();
  let parentId = 'party';
  for (let i = 0; i < MAX_GROUP_DEPTH; i += 1) {
    const id = `level-${i}`;
    deep.groups.push({ id, name: id, parentId, members: [], delegates: [], topics: [] });
    parentId = id;
  }
  assert.equal(validateParent(deep, { parentId }).error, 'parent_too_deep');
});

test('a branch cachet outranks its parent group at equal priority', () => {
  const state = partyState();
  state.groups[0].delegates = [{ topic: 'energy', delegateHash: 'party-pick', priority: 1 }];
  state.groups[1].delegates = [{ topic: 'energy', delegateHash: 'tank-pick', priority: 1 }];
  // bruno is in both the party and its think tank.
  const rec = recommendDelegationForPerson({ pidHash: 'bruno' }, 'Energy', state);
  assert.equal(rec.chosen.delegateHash, 'tank-pick');
  assert.equal(rec.conflict, false, 'branch depth settles the tie the priority rule leaves open');
});

test('an explicit higher priority still beats branch depth', () => {
  const state = partyState();
  state.groups[0].delegates = [{ topic: 'energy', delegateHash: 'party-pick', priority: 9 }];
  state.groups[1].delegates = [{ topic: 'energy', delegateHash: 'tank-pick', priority: 1 }];
  const rec = recommendDelegationForPerson({ pidHash: 'bruno' }, 'Energy', state);
  assert.equal(rec.chosen.delegateHash, 'party-pick');
});

test('internal lanes are off by default and gate reading to members', () => {
  const state = partyState();
  const tank = state.groups[1];
  // Lane disabled: the scope is refused with a reason rather than silently empty.
  assert.equal(resolveGroupScope(state, { pidHash: 'bruno' }, 'think-tank', { lane: 'discussion' }).error, 'lane_disabled');

  withPolicy(state, 'think-tank', { lanes: { discussion: true }, lanesVisibility: 'members' });
  assert.equal(canReadGroupLane(state, { pidHash: 'bruno' }, tank), true, 'a member reads it');
  assert.equal(canReadGroupLane(state, { pidHash: 'ada' }, tank), false, 'a non-member does not');
  assert.equal(canReadGroupLane(state, null, tank), false, 'a guest does not');
  assert.equal(canPostToGroupLane(state, { pidHash: 'ada' }, tank, 'discussion'), false);
  assert.equal(canPostToGroupLane(state, { pidHash: 'bruno' }, tank, 'discussion'), true);
});

test('a public lane visibility opens reading without opening posting', () => {
  const state = withPolicy(partyState(), 'think-tank', {
    lanes: { discussion: true },
    lanesVisibility: 'public',
  });
  const tank = state.groups[1];
  assert.equal(canReadGroupLane(state, { pidHash: 'ada' }, tank), true);
  assert.equal(canPostToGroupLane(state, { pidHash: 'ada' }, tank, 'discussion'), false);
});

test('group-scoped entries stay out of the Circle feed', () => {
  const circleEntry = { id: 'a', groupId: null };
  const groupEntry = { id: 'b', groupId: 'think-tank' };
  assert.equal(matchesGroupScope(circleEntry, null), true);
  assert.equal(matchesGroupScope(groupEntry, null), false, 'an internal lane must not leak into the Circle feed');
  assert.equal(matchesGroupScope(groupEntry, 'think-tank'), true);
  assert.equal(matchesGroupScope(circleEntry, 'think-tank'), false);
});

test('promotion moves a branch item to its parent group', () => {
  const state = withPolicy(partyState(), 'party', { lanes: { discussion: true } });
  withPolicy(state, 'think-tank', { lanes: { discussion: true } });
  const entry = { id: 'd1', groupId: 'think-tank', content: 'note' };

  const target = resolvePromotionTarget(state, 'think-tank');
  assert.equal(target.targetId, 'party');

  // bruno is the think tank's admin.
  const result = applyPromotion(state, { pidHash: 'bruno' }, { kind: 'discussion', entry });
  assert.equal(result.ok, true);
  assert.equal(entry.groupId, 'party');
  assert.equal(entry.promotions.length, 1);
  assert.equal(entry.promotions[0].toGroupName, 'Rete Civica');
});

test('promotion from a top-level group lands at Circle level', () => {
  const state = withPolicy(partyState(), 'party', { lanes: { discussion: true } });
  const entry = { id: 'd1', groupId: 'party' };
  const result = applyPromotion(state, { pidHash: 'ada' }, { kind: 'discussion', entry });
  assert.equal(result.ok, true);
  assert.equal(entry.groupId, null, 'no parent means the whole Circle');
  assert.equal(resolvePromotionTarget(state, 'party').targetLabel, 'the whole Circle');
});

test('promotion is refused to non-admins, to already-top-level items, and into a closed parent lane', () => {
  const state = withPolicy(partyState(), 'think-tank', { lanes: { discussion: true } });

  // Every refusal asserts `ok` as well as `error`. A verdict that reports the right error
  // while still saying ok:true is exactly the failure this guards: the refusal branches
  // attach the resolved group for context, and spreading that context over the verdict
  // silently re-opened the gate.
  const notAdmin = evaluatePromotion(state, { pidHash: 'ada' }, { kind: 'discussion', entry: { id: 'x', groupId: 'think-tank' } });
  assert.equal(notAdmin.ok, false, 'a non-admin must be refused, not merely annotated');
  assert.equal(notAdmin.error, 'group_admin_required');

  const topLevel = evaluatePromotion(state, { pidHash: 'bruno' }, { kind: 'discussion', entry: { id: 'x', groupId: null } });
  assert.equal(topLevel.ok, false);
  assert.equal(topLevel.error, 'already_top_level');

  // The party has not opened its discussion lane, so there is nowhere to land.
  const closedLane = evaluatePromotion(state, { pidHash: 'bruno' }, { kind: 'discussion', entry: { id: 'x', groupId: 'think-tank' } });
  assert.equal(closedLane.ok, false);
  assert.equal(closedLane.error, 'parent_lane_disabled');
});

test('a refused promotion does not move the item', () => {
  const state = withPolicy(partyState(), 'think-tank', { lanes: { discussion: true } });
  withPolicy(state, 'party', { lanes: { discussion: true } });
  // ada admins the party but is not a member of the think tank the item lives in.
  const entry = { id: 'd1', groupId: 'think-tank' };
  const result = applyPromotion(state, { pidHash: 'ada' }, { kind: 'discussion', entry });
  assert.equal(result.ok, false);
  assert.equal(entry.groupId, 'think-tank', 'the item stays where it was');
  assert.equal(entry.promotions, undefined, 'and no trail is stamped');
});

test('a guest cannot promote anything', () => {
  const state = withPolicy(partyState(), 'think-tank', { lanes: { discussion: true } });
  withPolicy(state, 'party', { lanes: { discussion: true } });
  const entry = { id: 'd1', groupId: 'think-tank' };
  assert.equal(applyPromotion(state, null, { kind: 'discussion', entry }).ok, false);
  assert.equal(entry.groupId, 'think-tank');
});

test('promotion keeps the item id, so its comments, signatures and votes travel with it', () => {
  const state = withPolicy(partyState(), 'party', { lanes: { petitions: true } });
  withPolicy(state, 'think-tank', { lanes: { petitions: true } });
  const petition = { id: 'p-1', groupId: 'think-tank', title: 'Solar tender' };
  applyPromotion(state, { pidHash: 'bruno' }, { kind: 'petition', entry: petition });
  assert.equal(petition.id, 'p-1', 'a promotion is a move, not a copy');
});

test('the category directory indexes declared categories and who groups put forward', () => {
  const state = partyState();
  state.groups[1].delegates = [{ topic: 'energy / solar', delegateHash: 'solar-expert', priority: 2 }];
  state.groups[0].delegates = [{ topic: 'energy', delegateHash: 'party-pick', priority: 1 }];

  const directory = buildCategoryDirectory(state);
  const byKey = new Map(directory.map((row) => [row.key, row]));

  assert.ok(byKey.has('energy'), 'the party declared Energy');
  assert.ok(byKey.has('energy / solar') || byKey.has('energy/solar'), 'the branch declared a subcategory');
  assert.deepEqual(byKey.get('energy').delegates.map((d) => d.delegateHash), ['party-pick']);
  assert.deepEqual(byKey.get('energy').groups.map((g) => g.id), ['party']);
});

test('an election winner who is also the cachet is listed once, as elected', () => {
  const state = withPolicy(partyState(), 'party', { electionMode: 'vote' });
  // Closing an election writes the winner as the cachet too (A5.6).
  state.groups[0].delegates = [{ topic: 'energy', delegateHash: 'party-pick', priority: 10 }];
  state.groupElections = [
    {
      id: 'e1',
      groupId: 'party',
      topic: 'energy',
      status: 'closed',
      candidates: ['party-pick', 'runner-up'],
      votes: [
        { voterHash: 'ada', candidateHash: 'party-pick' },
        { voterHash: 'bruno', candidateHash: 'party-pick' },
      ],
    },
  ];
  const row = buildCategoryDirectory(state).find((entry) => entry.key === 'energy');
  assert.equal(row.delegates.length, 1, 'one row per group and person');
  assert.equal(row.delegates[0].source, 'election');
});

test('a category with no delegate still lists its groups, so members can go ask', () => {
  const state = partyState();
  const row = buildCategoryDirectory(state).find((entry) => entry.key === 'energy');
  assert.equal(row.delegates.length, 0);
  assert.deepEqual(row.groups.map((g) => g.name), ['Rete Civica']);
});

test('migration 24 defaults groups to top level, lanes off, and entries to Circle scope', () => {
  const { data, meta } = runMigrations({
    data: {
      groups: [{ id: 'g1', name: 'Legacy' }],
      groupPolicies: [{ groupId: 'g1', electionMode: 'vote' }],
      discussions: [{ id: 'd1', content: 'existing' }],
      petitions: [{ id: 'p1', title: 'existing' }],
      settings: {},
    },
    meta: { schemaVersion: 23, migrations: [] },
  });

  assert.equal(meta.schemaVersion, LATEST_SCHEMA_VERSION);
  assert.equal(data.groups[0].parentId, null);
  assert.deepEqual(data.groups[0].topics, []);
  assert.deepEqual(data.groupPolicies[0].lanes, { discussion: false, petitions: false });
  assert.equal(data.groupPolicies[0].lanesVisibility, 'members');
  assert.equal(data.groupPolicies[0].electionMode, 'vote', 'existing policy fields survive');
  assert.equal(data.discussions[0].groupId, null, 'an existing post was addressed to everyone');
  assert.equal(data.petitions[0].groupId, null);
});
