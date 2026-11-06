import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canModerateGroupLane,
  getGroupMemberRole,
  isGroupAdmin,
  recommendDelegationForPerson,
  setGroupMemberRole,
} from '../src/modules/groups/groups.js';
import {
  applyPromotion,
  applyPromotionDecision,
  applyPromotionRequest,
  evaluatePromotionDecision,
  evaluatePromotionRequest,
  getOpenPromotionRequest,
} from '../src/modules/groups/promotion.js';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../src/infra/persistence/migrations.js';

const dataConfig = { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false };

// ada admins the party; bruno admins the think-tank branch; carla is a plain branch member.
function partyState() {
  return {
    dataConfig,
    settings: {},
    // setGroupMemberRole persists; the fixture provides the one hook it reaches for.
    store: { saveGroups: async () => {} },
    groups: [
      {
        id: 'party',
        name: 'Rete Civica',
        parentId: null,
        members: ['ada', 'bruno'],
        roles: [{ hash: 'ada', role: 'admin' }, { hash: 'bruno', role: 'member' }],
        delegates: [],
        topics: [],
      },
      {
        id: 'tank',
        name: 'Energy Think Tank',
        parentId: 'party',
        members: ['bruno', 'carla', 'dario'],
        roles: [
          { hash: 'bruno', role: 'admin' },
          { hash: 'carla', role: 'member' },
          { hash: 'dario', role: 'member' },
        ],
        delegates: [],
        topics: [],
      },
    ],
    groupPolicies: [
      { groupId: 'party', electionMode: 'vote', conflictRule: 'highest_priority', lanes: { discussion: true } },
      { groupId: 'tank', electionMode: 'vote', conflictRule: 'highest_priority', lanes: { discussion: true } },
    ],
    groupElections: [],
    discussions: [],
    petitions: [],
    sessions: [],
  };
}

function policyOf(state, groupId) {
  return state.groupPolicies.find((entry) => entry.groupId === groupId);
}

// --- lane moderator role -----------------------------------------------------

test('a lane moderator can act on lane items without being an admin', async () => {
  const state = partyState();
  const tank = state.groups[1];

  assert.equal(canModerateGroupLane(tank, 'carla'), false);
  await setGroupMemberRole({ groupId: 'tank', memberHash: 'carla', role: 'laneModerator', state });

  assert.equal(getGroupMemberRole(tank, 'carla'), 'laneModerator');
  assert.equal(canModerateGroupLane(tank, 'carla'), true, 'can act on the lane');
  assert.equal(isGroupAdmin(tank, 'carla'), false, 'but is not an admin');
});

test('a lane moderator can promote', () => {
  const state = partyState();
  state.groups[1].roles = state.groups[1].roles.map((entry) =>
    entry.hash === 'carla' ? { ...entry, role: 'laneModerator' } : entry,
  );
  const entry = { id: 'd1', groupId: 'tank' };
  assert.equal(applyPromotion(state, { pidHash: 'carla' }, { kind: 'discussion', entry }).ok, true);
  assert.equal(entry.groupId, 'party');
});

test('a role can only be given to an actual member, and must be a known role', async () => {
  const state = partyState();
  assert.equal((await setGroupMemberRole({ groupId: 'tank', memberHash: 'stranger', role: 'admin', state })).error, 'not_a_member');
  assert.equal((await setGroupMemberRole({ groupId: 'tank', memberHash: 'carla', role: 'overlord', state })).error, 'invalid_role');
});

test('a group cannot be left without an admin', async () => {
  const state = partyState();
  // bruno is the tank's only admin.
  const result = await setGroupMemberRole({ groupId: 'tank', memberHash: 'bruno', role: 'member', state });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'last_admin');
  assert.equal(getGroupMemberRole(state.groups[1], 'bruno'), 'admin', 'the demotion did not happen');
});

// --- promotion requests ------------------------------------------------------

test('an ordinary member can ask for an item to move up', () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };

  const result = applyPromotionRequest(state, { pidHash: 'carla' }, {
    kind: 'discussion',
    entry,
    note: 'This concerns the whole party.',
  });
  assert.equal(result.ok, true);
  assert.equal(entry.groupId, 'tank', 'asking does not move anything');
  const open = getOpenPromotionRequest(entry);
  assert.equal(open.byHash, 'carla');
  assert.equal(open.note, 'This concerns the whole party.');
  assert.equal(open.targetLabel, 'Rete Civica');
});

test('someone who can already promote is not offered a request', () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };
  const decision = evaluatePromotionRequest(state, { pidHash: 'bruno' }, { kind: 'discussion', entry });
  assert.equal(decision.ok, false);
  assert.equal(decision.error, 'can_promote_directly');
});

test('a non-member cannot request, and a second request cannot stack', () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };

  const outsider = evaluatePromotionRequest(state, { pidHash: 'ada' }, { kind: 'discussion', entry });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error, 'group_membership_required');

  applyPromotionRequest(state, { pidHash: 'carla' }, { kind: 'discussion', entry });
  const second = applyPromotionRequest(state, { pidHash: 'dario' }, { kind: 'discussion', entry });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'request_already_open');
  assert.equal(entry.promotionRequests.length, 1);
});

test('approving a request performs the move and records who asked', () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };
  applyPromotionRequest(state, { pidHash: 'carla' }, { kind: 'discussion', entry });

  const result = applyPromotionDecision(state, { pidHash: 'bruno' }, {
    kind: 'discussion',
    entry,
    decision: 'approve',
  });
  assert.equal(result.ok, true);
  assert.equal(result.approved, true);
  assert.equal(entry.groupId, 'party');
  assert.equal(entry.promotionRequests[0].status, 'approved');
  assert.equal(entry.promotionRequests[0].byHash, 'carla');
  assert.equal(entry.promotions.length, 1);
});

test('declining records the reason and leaves the item where it was', () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };
  applyPromotionRequest(state, { pidHash: 'carla' }, { kind: 'discussion', entry });

  const result = applyPromotionDecision(state, { pidHash: 'bruno' }, {
    kind: 'discussion',
    entry,
    decision: 'decline',
    reason: 'Still a branch matter.',
  });
  assert.equal(result.ok, true);
  assert.equal(result.approved, false);
  assert.equal(entry.groupId, 'tank');
  assert.equal(entry.promotionRequests[0].status, 'declined');
  assert.equal(entry.promotionRequests[0].reason, 'Still a branch matter.');
});

test('a requester cannot decide or move their own open request after becoming a lane moderator', async () => {
  const state = partyState();
  const entry = { id: 'd1', groupId: 'tank' };
  applyPromotionRequest(state, { pidHash: 'carla' }, { kind: 'discussion', entry });

  const byRequester = evaluatePromotionDecision(state, { pidHash: 'carla' }, { kind: 'discussion', entry });
  assert.equal(byRequester.ok, false, 'the asker cannot approve their own request');
  assert.equal(byRequester.error, 'group_admin_required');

  assert.equal((await setGroupMemberRole({
    groupId: 'tank', memberHash: 'carla', role: 'laneModerator', state,
  })).ok, true);
  const result = applyPromotionDecision(state, { pidHash: 'carla' }, {
    kind: 'discussion',
    entry,
    decision: 'approve',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'own_promotion_request');
  assert.equal(applyPromotion(state, { pidHash: 'carla' }, { kind: 'discussion', entry }).error, 'own_promotion_request');
  assert.equal(entry.groupId, 'tank');
  assert.equal(getOpenPromotionRequest(entry)?.status, 'open');
});

test('an approval blocked by a closed parent lane leaves the request open', () => {
  const state = partyState();
  policyOf(state, 'party').lanes = { discussion: false };
  const entry = { id: 'd1', groupId: 'tank' };
  applyPromotionRequest(state, { pidHash: 'carla' }, { kind: 'discussion', entry });
  const pending = { ...getOpenPromotionRequest(entry) };

  const result = applyPromotionDecision(state, { pidHash: 'bruno' }, {
    kind: 'discussion',
    entry,
    decision: 'approve',
    reason: 'Ready to move.',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'parent_lane_disabled');
  assert.equal(entry.groupId, 'tank');
  assert.deepEqual(getOpenPromotionRequest(entry), pending, 'a blocked approval leaves the request intact');
});

// --- branch election roll-up -------------------------------------------------

function closedElection({ id, groupId, topic, winner, closedAt }) {
  return {
    id,
    groupId,
    topic,
    status: 'closed',
    candidates: [winner, 'other'],
    votes: [{ voterHash: 'v1', candidateHash: winner }],
    createdAt: closedAt,
    closedAt,
  };
}

test('roll-up is off by default: a parent ignores its branch election', () => {
  const state = partyState();
  state.groupElections = [
    closedElection({ id: 'e1', groupId: 'tank', topic: 'energy', winner: 'expert', closedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  // ada is only in the party, which has no election of its own.
  const rec = recommendDelegationForPerson({ pidHash: 'ada' }, 'Energy', state);
  assert.equal(rec.suggestions.length, 0);
});

test('an opted-in parent adopts a branch election and says where it came from', () => {
  const state = partyState();
  policyOf(state, 'party').adoptBranchElections = true;
  state.groupElections = [
    closedElection({ id: 'e1', groupId: 'tank', topic: 'energy', winner: 'expert', closedAt: '2026-01-02T00:00:00.000Z' }),
  ];

  const rec = recommendDelegationForPerson({ pidHash: 'ada' }, 'Energy', state);
  assert.equal(rec.chosen.delegateHash, 'expert');
  assert.equal(rec.chosen.provider, 'branch-election');
  assert.equal(
    rec.chosen.adoptedFromGroupName,
    'Energy Think Tank',
    'an adopted result must not look like the parent decided it',
  );
});

test("a group's own election always beats an adopted branch one", () => {
  const state = partyState();
  policyOf(state, 'party').adoptBranchElections = true;
  state.groupElections = [
    // The branch voted more recently, and still must not override the party's own vote.
    closedElection({ id: 'e1', groupId: 'party', topic: 'energy', winner: 'party-pick', closedAt: '2026-01-01T00:00:00.000Z' }),
    closedElection({ id: 'e2', groupId: 'tank', topic: 'energy', winner: 'branch-pick', closedAt: '2026-06-01T00:00:00.000Z' }),
  ];

  const rec = recommendDelegationForPerson({ pidHash: 'ada' }, 'Energy', state);
  assert.equal(rec.chosen.delegateHash, 'party-pick');
  assert.equal(rec.chosen.provider, 'group-election');
});

test('roll-up does not reach sideways into an unrelated group', () => {
  const state = partyState();
  policyOf(state, 'party').adoptBranchElections = true;
  state.groups.push({ id: 'other', name: 'Unrelated', parentId: null, members: [], roles: [], delegates: [], topics: [] });
  state.groupElections = [
    closedElection({ id: 'e1', groupId: 'other', topic: 'energy', winner: 'stranger', closedAt: '2026-01-02T00:00:00.000Z' }),
  ];
  const rec = recommendDelegationForPerson({ pidHash: 'ada' }, 'Energy', state);
  assert.equal(rec.suggestions.length, 0, 'only descendants roll up');
});

// --- migration ---------------------------------------------------------------

test('migration 25 normalizes roles, defaults roll-up off, and seeds request lists', () => {
  const { data, meta } = runMigrations({
    data: {
      groups: [{ id: 'g1', roles: [{ hash: 'a', role: 'admin' }, { hash: 'b', role: 'overlord' }, { hash: 'c' }] }],
      groupPolicies: [{ groupId: 'g1', electionMode: 'vote' }],
      discussions: [{ id: 'd1' }],
      petitions: [{ id: 'p1' }],
      settings: {},
    },
    meta: { schemaVersion: 24, migrations: [] },
  });

  assert.equal(meta.schemaVersion, LATEST_SCHEMA_VERSION);
  const roles = data.groups[0].roles;
  assert.equal(roles[0].role, 'admin', 'known roles survive');
  assert.equal(roles[1].role, 'member', 'an unknown role falls back rather than being dropped');
  assert.equal(roles.length, 3, 'no member is lost');
  assert.equal(data.groupPolicies[0].adoptBranchElections, false);
  assert.deepEqual(data.discussions[0].promotionRequests, []);
  assert.deepEqual(data.petitions[0].promotionRequests, []);
});
