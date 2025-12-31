import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGroup,
  getGroupMemberRole,
  isGroupAdmin,
  isGroupMember,
  joinGroup,
  leaveGroup,
} from '../src/modules/groups/groups.js';

function buildState() {
  return {
    groups: [],
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveGroups: async () => {} },
  };
}

test('group membership assigns and removes roles', async () => {
  const state = buildState();
  const group = await createGroup({
    name: 'Test Group',
    description: 'Test',
    topics: ['general'],
    creatorHash: 'creator-hash',
    state,
  });

  assert.equal(isGroupAdmin(group, 'creator-hash'), true);
  assert.equal(getGroupMemberRole(group, 'creator-hash'), 'admin');

  const person = { pidHash: 'member-hash' };
  await joinGroup({ groupId: group.id, person, state });
  assert.equal(isGroupMember(group, person.pidHash), true);
  assert.equal(getGroupMemberRole(group, person.pidHash), 'member');

  await leaveGroup({ groupId: group.id, person, state });
  assert.equal(isGroupMember(group, person.pidHash), false);
  assert.equal(getGroupMemberRole(group, person.pidHash), null);
});
