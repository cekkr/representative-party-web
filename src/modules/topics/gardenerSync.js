import { TOPIC_GARDENER_SYNC_SECONDS } from '../../config.js';
import { persistSettings, persistTopics } from '../../infra/persistence/storage.js';
import { isModuleEnabled } from '../circle/modules.js';
import { appendTopicHistory, findTopicByPathKey, labelFromKey } from './registry.js';
import { fetchGardenerOperations, getTopicConfig } from './topicGardenerClient.js';

const DEFAULT_SYNC_SECONDS = 120;

export function startTopicGardenerScheduler(state, { intervalSeconds } = {}) {
  const configured = Number.isFinite(intervalSeconds) ? intervalSeconds : TOPIC_GARDENER_SYNC_SECONDS;
  const seconds = Number.isFinite(configured) ? configured : DEFAULT_SYNC_SECONDS;
  if (seconds <= 0) return () => {};
  const intervalMs = seconds * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncTopicGardenerOperations(state, { source: 'scheduler' });
    } catch (error) {
      console.warn(`[topic-gardener] sync failed: ${error.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

export async function syncTopicGardenerOperations(state, { source = 'manual' } = {}) {
  if (!state) return { updated: false, reason: 'missing_state' };
  if (!isModuleEnabled(state, 'topicGardener')) {
    return { updated: false, reason: 'module_disabled' };
  }
  const config = getTopicConfig(state);
  if (!config.url && !state?.helpers?.topicGardener?.operations) {
    return { updated: false, reason: 'no_helper' };
  }

  const operations = await fetchGardenerOperations(state);
  const lastOperationAt = Number(state.settings?.topicGardener?.lastOperationAt || 0);
  const freshOps = operations.filter((op) => Number(op?.at || 0) > lastOperationAt);
  const now = new Date().toISOString();
  const summary = applyGardenerOperations(state, freshOps, { source });
  const maxAt = freshOps.reduce((max, op) => {
    const value = Number(op?.at || 0);
    return Number.isFinite(value) && value > max ? value : max;
  }, lastOperationAt);

  if (summary.updatedTopics) {
    await persistTopics(state);
  }

  const nextGardener = {
    ...(state.settings?.topicGardener || {}),
    lastOperationAt: maxAt,
    lastSyncAt: now,
  };
  state.settings = { ...(state.settings || {}), topicGardener: nextGardener };
  await persistSettings(state);

  return { ...summary, lastOperationAt: maxAt };
}

function applyGardenerOperations(state, operations = [], { source } = {}) {
  if (!operations.length) return { updatedTopics: 0, pendingRenames: 0, processed: 0 };
  let updatedTopics = 0;
  let pendingRenames = 0;
  let pendingMerges = 0;
  let pendingSplits = 0;

  for (const operation of operations) {
    const type = String(operation?.type || '').toLowerCase();
    const fromKey = String(operation?.from || '').trim();
    const toKey = String(operation?.to || '').trim();
    const suggested = Array.isArray(operation?.suggested) ? operation.suggested : [];
    const reason = operation?.reason || '';
    const atSeconds = Number(operation?.at || 0);
    const timestamp = Number.isFinite(atSeconds) && atSeconds > 0 ? new Date(atSeconds * 1000).toISOString() : new Date().toISOString();

    if (!fromKey) continue;
    const fromTopic = findTopicByPathKey(state, fromKey);
    if (!fromTopic) continue;

    appendTopicHistory(fromTopic, {
      at: timestamp,
      action: type || 'operation',
      source,
      reason,
      from: fromKey,
      to: toKey || null,
      suggested,
    });

    if (type === 'merge' && toKey) {
      const toTopic = findTopicByPathKey(state, toKey);
      if (toTopic) {
        appendTopicHistory(toTopic, {
          at: timestamp,
          action: 'merge',
          source,
          reason,
          from: fromKey,
          to: toKey,
        });
        toTopic.updatedAt = timestamp;
        updatedTopics += 1;
      }
      const pending = {
        toKey,
        toLabel: toTopic?.label || labelFromKey(toKey),
        toId: toTopic?.id || null,
        at: timestamp,
        reason,
        source,
      };
      fromTopic.pendingMerge = pending;
      pendingMerges += 1;
    }

    if (type === 'rename' && toKey) {
      const nextLabel = labelFromKey(toKey);
      const pendingRename = {
        toKey,
        toLabel: nextLabel,
        at: timestamp,
        reason,
        source,
      };
      fromTopic.pendingRename = pendingRename;
      pendingRenames += 1;
    }

    if (type === 'split' && suggested.length) {
      const pendingSplit = {
        suggested: suggested.map((entry) => labelFromKey(entry)),
        at: timestamp,
        reason,
        source,
      };
      fromTopic.pendingSplit = pendingSplit;
      pendingSplits += 1;
    }

    fromTopic.updatedAt = timestamp;
    updatedTopics += 1;
  }

  return { updatedTopics, pendingRenames, pendingMerges, pendingSplits, processed: operations.length };
}
