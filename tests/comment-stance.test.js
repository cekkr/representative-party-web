import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCommentStanceLabel,
  listCommentStances,
  normalizeCommentStance,
} from '../src/modules/petitions/commentStance.js';

test('normalizeCommentStance maps aliases and defaults to comment', () => {
  assert.equal(normalizeCommentStance('pro'), 'support');
  assert.equal(normalizeCommentStance('CON'), 'concern');
  assert.equal(normalizeCommentStance('question'), 'question');
  assert.equal(normalizeCommentStance(''), 'comment');
});

test('getCommentStanceLabel returns human labels', () => {
  assert.equal(getCommentStanceLabel('support'), 'Support');
  assert.equal(getCommentStanceLabel('against'), 'Concern');
  assert.equal(getCommentStanceLabel('ask'), 'Question');
  assert.equal(getCommentStanceLabel('unknown'), 'Note');
});

test('listCommentStances exposes the base stance order', () => {
  const values = listCommentStances().map((entry) => entry.value);
  assert.deepEqual(values, ['support', 'concern', 'question', 'comment']);
});
