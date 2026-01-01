import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFeed, createPost } from '../src/modules/social/posts.js';
import { ensureFollowEdge } from '../src/modules/social/followGraph.js';

function buildState() {
  return {
    socialPosts: [],
    socialFollows: [],
    settings: { policyId: 'party-circle-alpha', policyVersion: 1 },
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
  };
}

test('createPost extracts mentions and tags', () => {
  const state = buildState();
  const person = { pidHash: 'hash-1', handle: 'person-hash' };
  const post = createPost(state, { person, content: 'Hello @Alice #Energy #energy', baseUrl: 'http://local' });
  assert.deepEqual(post.mentions, ['alice']);
  assert.deepEqual(post.tags, ['energy']);
});

test('createPost allows reshare without a comment', () => {
  const state = buildState();
  const person = { pidHash: 'hash-1', handle: 'person-hash' };
  const original = createPost(state, { person, content: 'Original note', baseUrl: 'http://local' });
  const reshare = createPost(state, { person, content: '', reshareOf: original.id, baseUrl: 'http://local' });
  assert.equal(reshare.reshareOf, original.id);
  assert.equal(reshare.content, '');
  assert.equal(reshare.reshare.authorHandle, original.authorHandle);
});

test('createPost allows media-only posts', () => {
  const state = buildState();
  const person = { pidHash: 'hash-1', handle: 'person-hash' };
  const post = createPost(state, { person, content: '', mediaIds: ['media-1'], baseUrl: 'http://local' });
  assert.deepEqual(post.mediaIds, ['media-1']);
});

test('createPost blocks reshare of direct posts', () => {
  const state = buildState();
  const person = { pidHash: 'hash-1', handle: 'person-hash' };
  const direct = createPost(state, {
    person,
    content: 'Direct note',
    visibility: 'direct',
    targetHash: 'hash-2',
    targetHandle: 'person-two',
    baseUrl: 'http://local',
  });
  assert.throws(
    () => createPost(state, { person, content: '', reshareOf: direct.id, baseUrl: 'http://local' }),
    (error) => error && error.code === 'reshare_private',
  );
});

test('createPost rejects empty submissions without media or reshares', () => {
  const state = buildState();
  const person = { pidHash: 'hash-2', handle: 'person-two' };
  assert.throws(
    () => createPost(state, { person, content: '', baseUrl: 'http://local' }),
    (error) => error && error.code === 'missing_content',
  );
});

test('createPost requires target hash for direct visibility', () => {
  const state = buildState();
  const person = { pidHash: 'hash-3', handle: 'person-three' };
  assert.throws(
    () => createPost(state, { person, content: 'Private', visibility: 'direct', baseUrl: 'http://local' }),
    (error) => error && error.code === 'missing_target',
  );
});

test('createPost blocks conflicting reply and reshare intent', () => {
  const state = buildState();
  const person = { pidHash: 'hash-4', handle: 'person-four' };
  assert.throws(
    () =>
      createPost(state, {
        person,
        content: 'Conflicting intent',
        replyTo: 'post-1',
        reshareOf: 'post-2',
        baseUrl: 'http://local',
      }),
    (error) => error && error.code === 'conflicting_intent',
  );
});

test('buildFeed returns posts from followed handles and respects follow types', () => {
  const state = buildState();
  const alice = { pidHash: 'alice', handle: 'alice' };
  const bob = { pidHash: 'bob', handle: 'bob' };
  const carol = { pidHash: 'carol', handle: 'carol' };

  createPost(state, { person: bob, content: 'Bob alert', baseUrl: 'http://local' });
  createPost(state, { person: carol, content: 'Carol update', baseUrl: 'http://local' });
  createPost(state, { person: alice, content: 'Alice note', baseUrl: 'http://local' });

  ensureFollowEdge(state, {
    followerHash: alice.pidHash,
    targetHash: bob.pidHash,
    targetHandle: bob.handle,
    type: 'alerts',
  });

  const alertsFeed = buildFeed(state, alice, { followType: 'alerts' });
  assert.equal(alertsFeed.length, 2);
  assert.deepEqual(
    alertsFeed.map((post) => post.authorHash).sort(),
    [alice.pidHash, bob.pidHash].sort(),
  );

  const interestFeed = buildFeed(state, alice, { followType: 'interest' });
  assert.equal(interestFeed.length, 1);
  assert.equal(interestFeed[0].authorHash, alice.pidHash);
});

test('buildFeed includes direct posts only for author or target', () => {
  const state = buildState();
  const alice = { pidHash: 'alice-direct', handle: 'alice-direct' };
  const bob = { pidHash: 'bob-direct', handle: 'bob-direct' };
  const carol = { pidHash: 'carol-direct', handle: 'carol-direct' };

  createPost(state, {
    person: bob,
    content: 'Private hello',
    visibility: 'direct',
    targetHash: alice.pidHash,
    targetHandle: alice.handle,
    baseUrl: 'http://local',
  });

  const aliceFeed = buildFeed(state, alice);
  assert.equal(aliceFeed.length, 1);
  assert.equal(aliceFeed[0].visibility, 'direct');

  const carolFeed = buildFeed(state, carol);
  assert.equal(carolFeed.length, 0);

  const guestFeed = buildFeed(state, null);
  assert.equal(guestFeed.length, 0);
});
