import { persistSettings } from '../../infra/persistence/storage.js';

const EMPTY_MODULE_BUCKET = { total: 0, lastAt: null, byModule: {} };
const EMPTY_RATE_BUCKET = { total: 0, lastAt: null, byAction: {} };
const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_INTERVAL_SECONDS = 300;
const MAX_SNAPSHOTS = 500;
const PERSIST_THROTTLE_MS = 30_000;

export function recordModuleDisabled(state, moduleKey) {
  if (!state) return null;
  const metrics = ensureMetrics(state);
  incrementBucket(metrics.moduleDisabled, moduleKey, 'byModule');
  recordSnapshot(state, { moduleKey });
  return metrics.moduleDisabled;
}

export function recordRateLimit(state, action) {
  if (!state) return null;
  const metrics = ensureMetrics(state);
  incrementBucket(metrics.rateLimit, action, 'byAction');
  recordSnapshot(state, { action });
  return metrics.rateLimit;
}

export function getMetricsSnapshot(state) {
  const snapshot = summarizeSnapshots(state);
  if (snapshot) return snapshot;
  return snapshotFromLive(state);
}

export function getOpsMetricsConfig(state) {
  return resolveConfig(state);
}

function ensureMetrics(state) {
  if (!state.metrics) {
    state.metrics = {
      moduleDisabled: { ...EMPTY_MODULE_BUCKET, byModule: {} },
      rateLimit: { ...EMPTY_RATE_BUCKET, byAction: {} },
    };
  }
  return state.metrics;
}

function incrementBucket(bucket, key, mapKey) {
  const now = new Date().toISOString();
  bucket.total = Number(bucket.total || 0) + 1;
  bucket.lastAt = now;
  if (!key) return;
  if (!bucket[mapKey]) bucket[mapKey] = {};
  bucket[mapKey][key] = Number(bucket[mapKey][key] || 0) + 1;
}

function snapshotFromLive(state) {
  if (!state?.metrics) {
    return {
      moduleDisabled: { ...EMPTY_MODULE_BUCKET, byModule: {} },
      rateLimit: { ...EMPTY_RATE_BUCKET, byAction: {} },
      window: null,
    };
  }
  const moduleDisabled = state.metrics.moduleDisabled || EMPTY_MODULE_BUCKET;
  const rateLimit = state.metrics.rateLimit || EMPTY_RATE_BUCKET;
  return {
    moduleDisabled: {
      total: Number(moduleDisabled.total || 0),
      lastAt: moduleDisabled.lastAt || null,
      byModule: { ...(moduleDisabled.byModule || {}) },
    },
    rateLimit: {
      total: Number(rateLimit.total || 0),
      lastAt: rateLimit.lastAt || null,
      byAction: { ...(rateLimit.byAction || {}) },
    },
    window: null,
  };
}

function recordSnapshot(state, { moduleKey, action } = {}) {
  if (!state?.settings) return;
  const config = resolveConfig(state);
  const opsMetrics = ensureOpsSettings(state, config);
  const nowMs = Date.now();
  const bucketStart = computeBucketStart(nowMs, config.intervalSeconds);
  const bucketIso = new Date(bucketStart).toISOString();
  const snapshots = Array.isArray(opsMetrics.snapshots) ? opsMetrics.snapshots : [];
  let entry = snapshots[0];
  if (!entry || entry.at !== bucketIso) {
    entry = buildSnapshotEntry(bucketIso);
    snapshots.unshift(entry);
  }
  if (moduleKey) {
    incrementSnapshot(entry.moduleDisabled, moduleKey, 'byModule');
  }
  if (action) {
    incrementSnapshot(entry.rateLimit, action, 'byAction');
  }
  entry.lastAt = new Date(nowMs).toISOString();
  const pruned = pruneSnapshots(snapshots, nowMs, config);
  opsMetrics.snapshots = pruned;
  opsMetrics.lastSnapshotAt = entry.lastAt;
  schedulePersist(state, nowMs);
}

function summarizeSnapshots(state) {
  const opsMetrics = state?.settings?.opsMetrics;
  const snapshots = Array.isArray(opsMetrics?.snapshots) ? opsMetrics.snapshots : [];
  if (!snapshots.length) return null;
  const config = resolveConfig(state);
  const nowMs = Date.now();
  const pruned = pruneSnapshots(snapshots, nowMs, config);
  if (pruned.length !== snapshots.length) {
    opsMetrics.snapshots = pruned;
    schedulePersist(state, nowMs);
  }

  const moduleDisabled = { total: 0, lastAt: null, byModule: {} };
  const rateLimit = { total: 0, lastAt: null, byAction: {} };
  for (const entry of pruned) {
    mergeBucket(moduleDisabled, entry?.moduleDisabled, 'byModule');
    mergeBucket(rateLimit, entry?.rateLimit, 'byAction');
    moduleDisabled.lastAt = maxTimestamp(moduleDisabled.lastAt, entry?.lastAt);
    rateLimit.lastAt = maxTimestamp(rateLimit.lastAt, entry?.lastAt);
  }
  const oldest = pruned[pruned.length - 1];
  const newest = pruned[0];
  return {
    moduleDisabled,
    rateLimit,
    window: {
      retentionHours: config.retentionHours,
      intervalSeconds: config.intervalSeconds,
      snapshots: pruned.length,
      from: oldest?.at || null,
      to: newest?.at || null,
    },
  };
}

function resolveConfig(state) {
  const settings = state?.settings?.opsMetrics || {};
  const retentionHours = normalizeNumber(
    settings.retentionHours ?? process.env.METRICS_SNAPSHOT_RETENTION_HOURS,
    DEFAULT_RETENTION_HOURS,
    { min: 1, max: 720 },
  );
  const intervalSeconds = normalizeNumber(
    settings.intervalSeconds ?? process.env.METRICS_SNAPSHOT_INTERVAL_SECONDS,
    DEFAULT_INTERVAL_SECONDS,
    { min: 60, max: 86_400 },
  );
  return { retentionHours, intervalSeconds };
}

function normalizeNumber(value, fallback, { min, max } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const boundedMin = Number.isFinite(min) ? Math.max(parsed, min) : parsed;
  const bounded = Number.isFinite(max) ? Math.min(boundedMin, max) : boundedMin;
  return bounded;
}

function ensureOpsSettings(state, config) {
  if (!state.settings.opsMetrics) {
    state.settings.opsMetrics = {
      retentionHours: config.retentionHours,
      intervalSeconds: config.intervalSeconds,
      snapshots: [],
      lastSnapshotAt: null,
    };
  } else {
    state.settings.opsMetrics.retentionHours = config.retentionHours;
    state.settings.opsMetrics.intervalSeconds = config.intervalSeconds;
    if (!Array.isArray(state.settings.opsMetrics.snapshots)) {
      state.settings.opsMetrics.snapshots = [];
    }
  }
  return state.settings.opsMetrics;
}

function computeBucketStart(nowMs, intervalSeconds) {
  const intervalMs = Math.max(1, intervalSeconds) * 1000;
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

function buildSnapshotEntry(at) {
  return {
    at,
    lastAt: at,
    moduleDisabled: { total: 0, lastAt: null, byModule: {} },
    rateLimit: { total: 0, lastAt: null, byAction: {} },
  };
}

function incrementSnapshot(bucket, key, mapKey) {
  if (!bucket) return;
  bucket.total = Number(bucket.total || 0) + 1;
  bucket.lastAt = new Date().toISOString();
  if (!key) return;
  if (!bucket[mapKey]) bucket[mapKey] = {};
  bucket[mapKey][key] = Number(bucket[mapKey][key] || 0) + 1;
}

function pruneSnapshots(snapshots, nowMs, config) {
  const retentionMs = config.retentionHours * 60 * 60 * 1000;
  const cutoff = nowMs - retentionMs;
  const filtered = snapshots.filter((entry) => {
    const timestamp = Date.parse(entry?.at || '');
    if (Number.isNaN(timestamp)) return false;
    return timestamp >= cutoff;
  });
  return filtered.slice(0, MAX_SNAPSHOTS);
}

function mergeBucket(target, source, mapKey) {
  if (!source) return;
  target.total += Number(source.total || 0);
  const sourceMap = source[mapKey] || {};
  for (const [key, value] of Object.entries(sourceMap)) {
    target[mapKey][key] = Number(target[mapKey][key] || 0) + Number(value || 0);
  }
}

function maxTimestamp(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function schedulePersist(state, nowMs) {
  if (!state?.store?.saveSettings) return;
  if (state.metricsPersistPending) return;
  const lastPersist = Number(state.metricsPersistedAt || 0);
  if (nowMs - lastPersist < PERSIST_THROTTLE_MS) return;
  state.metricsPersistPending = true;
  state.metricsPersistedAt = nowMs;
  setTimeout(() => {
    persistSettings(state)
      .catch((error) => {
        console.warn('[metrics] persist failed', error);
      })
      .finally(() => {
        state.metricsPersistPending = false;
      });
  }, 0);
}
