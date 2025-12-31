import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTopicList, getTopicPreferences, parseTopicList, storeTopicPreferences } from '../src/modules/topics/preferences.js';

test('parseTopicList dedupes and trims entries', () => {
  const topics = parseTopicList('Energy, Economy, energy,  Health  ', { limit: 10 });
  assert.deepEqual(topics, ['Energy', 'Economy', 'Health']);
});

test('storeTopicPreferences writes provider-local preferences', () => {
  const state = { profileAttributes: [] };
  const person = { sessionId: 'sess-123', handle: 'person-abc' };
  storeTopicPreferences(state, person, 'general, society, general');
  const prefs = getTopicPreferences(state, person);
  assert.deepEqual(prefs, ['general', 'society']);
  assert.equal(formatTopicList(prefs), 'general, society');
});
