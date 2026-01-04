import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getMetricsSnapshot, recordModuleDisabled, recordRateLimit } from '../src/modules/ops/metrics.js';

test('metrics snapshot defaults to empty buckets', () => {
  const snapshot = getMetricsSnapshot({});
  assert.equal(snapshot.moduleDisabled.total, 0);
  assert.equal(snapshot.rateLimit.total, 0);
  assert.deepEqual(snapshot.moduleDisabled.byModule, {});
  assert.deepEqual(snapshot.rateLimit.byAction, {});
});

test('recordModuleDisabled increments totals and per-module counts', () => {
  const state = {};
  recordModuleDisabled(state, 'social');
  recordModuleDisabled(state, 'social');
  recordModuleDisabled(state, 'votes');

  const snapshot = getMetricsSnapshot(state);
  assert.equal(snapshot.moduleDisabled.total, 3);
  assert.equal(snapshot.moduleDisabled.byModule.social, 2);
  assert.equal(snapshot.moduleDisabled.byModule.votes, 1);
  assert.ok(snapshot.moduleDisabled.lastAt);
});

test('recordRateLimit increments totals and per-action counts', () => {
  const state = {};
  recordRateLimit(state, 'discussion_post');
  recordRateLimit(state, 'discussion_post');
  recordRateLimit(state, 'petition_comment');

  const snapshot = getMetricsSnapshot(state);
  assert.equal(snapshot.rateLimit.total, 3);
  assert.equal(snapshot.rateLimit.byAction.discussion_post, 2);
  assert.equal(snapshot.rateLimit.byAction.petition_comment, 1);
  assert.ok(snapshot.rateLimit.lastAt);
});

test('metrics snapshots persist into settings with retention window', () => {
  const state = { settings: {} };
  recordModuleDisabled(state, 'social');
  recordRateLimit(state, 'discussion_post');

  const snapshot = getMetricsSnapshot(state);
  assert.equal(snapshot.moduleDisabled.total, 1);
  assert.equal(snapshot.rateLimit.total, 1);
  assert.ok(snapshot.window);
  assert.equal(Array.isArray(state.settings.opsMetrics.snapshots), true);
  assert.equal(state.settings.opsMetrics.snapshots.length, 1);
});

test('metrics snapshots prune entries beyond retention window', () => {
  const staleDate = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const state = {
    settings: {
      opsMetrics: {
        retentionHours: 12,
        intervalSeconds: 300,
        snapshots: [
          {
            at: staleDate,
            lastAt: staleDate,
            moduleDisabled: { total: 4, byModule: { social: 4 } },
            rateLimit: { total: 2, byAction: { forum_thread: 2 } },
          },
        ],
      },
    },
  };

  const snapshot = getMetricsSnapshot(state);
  assert.equal(snapshot.moduleDisabled.total, 0);
  assert.equal(snapshot.rateLimit.total, 0);
  assert.equal(state.settings.opsMetrics.snapshots.length, 0);
});
