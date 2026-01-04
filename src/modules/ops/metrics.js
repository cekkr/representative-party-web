const EMPTY_MODULE_BUCKET = { total: 0, lastAt: null, byModule: {} };
const EMPTY_RATE_BUCKET = { total: 0, lastAt: null, byAction: {} };

export function recordModuleDisabled(state, moduleKey) {
  if (!state) return null;
  const metrics = ensureMetrics(state);
  incrementBucket(metrics.moduleDisabled, moduleKey, 'byModule');
  return metrics.moduleDisabled;
}

export function recordRateLimit(state, action) {
  if (!state) return null;
  const metrics = ensureMetrics(state);
  incrementBucket(metrics.rateLimit, action, 'byAction');
  return metrics.rateLimit;
}

export function getMetricsSnapshot(state) {
  if (!state?.metrics) {
    return {
      moduleDisabled: { ...EMPTY_MODULE_BUCKET, byModule: {} },
      rateLimit: { ...EMPTY_RATE_BUCKET, byAction: {} },
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
  };
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
