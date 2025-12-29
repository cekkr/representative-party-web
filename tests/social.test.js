import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPost } from '../src/modules/social/posts.js';

function buildState() {
  return { socialPosts: [], settings: { policyId: 'party-circle-alpha', policyVersion: 1 } };
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
