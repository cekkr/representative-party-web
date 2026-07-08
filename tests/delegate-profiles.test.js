import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDelegateProfile } from '../src/modules/delegation/delegateProfiles.js';

test('buildDelegateProfile aggregates bio, delegations, and endorsements', () => {
  const state = {
    sessions: new Map([
      [
        's1',
        {
          id: 's1',
          pidHash: 'hash1',
          handle: 'alice',
          role: 'person',
          banned: false,
        },
      ],
    ]),
    profileAttributes: [
      {
        sessionId: 's1',
        handle: 'alice',
        provider: {
          publicBio: 'Community organizer focused on energy policy.',
        },
      },
    ],
    delegations: [
      { ownerHash: 'h2', delegateHash: 'hash1', topic: 'energy', createdAt: '2024-01-01T00:00:00.000Z' },
      { ownerHash: 'h3', delegateHash: 'hash1', topic: 'energy', createdAt: '2024-01-02T00:00:00.000Z' },
      { ownerHash: 'hash1', delegateHash: 'h4', topic: 'health', createdAt: '2024-01-03T00:00:00.000Z' },
    ],
    votes: [
      { petitionId: 'p1', authorHash: 'hash1', choice: 'yes', createdAt: '2024-01-02T00:00:00.000Z' },
      { petitionId: 'p2', authorHash: 'hash1', choice: 'no', createdAt: '2024-01-03T00:00:00.000Z' },
    ],
    petitions: [
      {
        id: 'p1',
        authorHash: 'hash1',
        title: 'Energy transition',
        status: 'draft',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ],
    discussions: [{ id: 'd1', authorHash: 'hash1', createdAt: '2024-01-03T00:00:00.000Z' }],
    socialPosts: [{ id: 's1', authorHash: 'hash1', createdAt: '2024-01-04T00:00:00.000Z' }],
    groups: [
      {
        id: 'g1',
        name: 'Core Circle',
        members: ['hash1'],
        delegates: [
          {
            topic: 'energy',
            delegateHash: 'hash1',
            priority: 5,
            provider: 'group',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    groupElections: [
      {
        id: 'e1',
        groupId: 'g1',
        topic: 'energy',
        status: 'closed',
        candidates: ['hash1', 'hash2'],
        votes: [
          { voterHash: 'v1', candidateHash: 'hash1', castAt: '2024-01-01T00:00:00.000Z' },
        ],
        createdAt: '2024-01-01T00:00:00.000Z',
        closedAt: '2024-01-02T00:00:00.000Z',
      },
    ],
    groupPolicies: [{ groupId: 'g1', electionMode: 'vote', conflictRule: 'highest_priority' }],
  };

  const profile = buildDelegateProfile(state, 'hash1');

  assert.equal(profile.handle, 'alice');
  assert.equal(profile.bio, 'Community organizer focused on energy policy.');
  assert.equal(profile.incoming.total, 2);
  assert.equal(profile.incoming.uniqueOwners, 2);
  assert.equal(profile.outgoing.total, 1);
  assert.equal(profile.votes.yes, 1);
  assert.equal(profile.votes.no, 1);
  assert.ok(profile.endorsements.groups.some((entry) => entry.groupId === 'g1'));
  assert.ok(profile.endorsements.elections.some((entry) => entry.groupId === 'g1'));
  assert.equal(profile.activity.petitions, 1);
  assert.equal(profile.activity.socialPosts, 1);
});
