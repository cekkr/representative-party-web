import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTopic } from '../src/services/classification.js';
import { getTopicConfig } from '../src/services/topicGardenerClient.js';
import { resolveDelegation, setDelegation } from '../src/services/delegation.js';
import { recommendDelegationForCitizen } from '../src/services/groups.js';

test('classifyTopic falls back to general without extensions', async () => {
  const topic = await classifyTopic('Any text', { extensions: { active: [] }, settings: {} });
  assert.equal(topic, 'general');
});

test('classifyTopic uses topic gardener helper and caches result', async () => {
  let calls = 0;
  const state = {
    extensions: { active: [] },
    settings: { topicGardener: { anchors: ['general', 'energy'], pinned: ['energy'] } },
    helpers: {
      topicGardener: {
        classify: async ({ text, anchors, pinned }) => {
          calls += 1;
          assert.equal(text, 'Energy policy note');
          assert.ok(anchors.includes('energy'));
          assert.ok(pinned.includes('energy'));
          return { topic: 'energy-policy' };
        },
      },
    },
  };

  const topicFirst = await classifyTopic('Energy policy note', state);
  const topicSecond = await classifyTopic('Energy policy note', state);
  assert.equal(topicFirst, 'energy');
  assert.equal(topicSecond, 'energy');
  assert.equal(calls, 1);
});

test('classifyTopic reconciles provider topics back to anchors', async () => {
  const state = {
    extensions: {
      active: [
        {
          id: 'local-classifier',
          classifyTopic: () => 'climate-change',
        },
      ],
    },
    settings: { topicGardener: { anchors: ['general', 'climate'], pinned: [] } },
  };
  const topic = await classifyTopic('Some post content', state);
  assert.equal(topic, 'climate');
});

test('topic gardener config falls back to environment when admin settings are absent', (t) => {
  const prevUrl = process.env.TOPIC_GARDENER_URL;
  const prevAnchors = process.env.TOPIC_GARDENER_ANCHORS;
  process.env.TOPIC_GARDENER_URL = 'http://example.test/classify';
  process.env.TOPIC_GARDENER_ANCHORS = 'alpha,beta';
  process.env.TOPIC_GARDENER_PINNED = 'beta';
  t.after(() => {
    process.env.TOPIC_GARDENER_URL = prevUrl;
    process.env.TOPIC_GARDENER_ANCHORS = prevAnchors;
    delete process.env.TOPIC_GARDENER_PINNED;
  });
  const config = getTopicConfig({ settings: {} });
  assert.equal(config.url, 'http://example.test/classify');
  assert.deepEqual(config.anchors, ['alpha', 'beta']);
  assert.deepEqual(config.pinned, ['beta']);
});

test('resolveDelegation uses stored entry', async () => {
  const state = {
    delegations: [],
    extensions: { active: [] },
    store: { saveDelegations: async () => {} },
    groups: [],
  };
  const citizen = { pidHash: 'hash-1' };
  await setDelegation({ citizen, topic: 'energy', delegateHash: 'delegate-hash', provider: 'peer', state });
  const result = resolveDelegation(citizen, 'energy', state);
  assert.equal(result.delegateHash, 'delegate-hash');
});

test('group recommendations provide prioritized delegate', () => {
  const citizen = { pidHash: 'me' };
  const state = {
    delegations: [],
    extensions: { active: [] },
    groups: [
      { id: 'g1', members: ['me'], delegates: [{ topic: 'energy', delegateHash: 'd1', priority: 2 }] },
      { id: 'g2', members: ['me'], delegates: [{ topic: 'energy', delegateHash: 'd2', priority: 1 }] },
    ],
  };
  const rec = recommendDelegationForCitizen(citizen, 'energy', state);
  assert.equal(rec.chosen.delegateHash, 'd1');
  assert.equal(rec.conflict, false);
});
