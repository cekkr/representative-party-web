import http from 'node:http';

import { HOST, MEDIA, PORT, REQUEST_BODY } from '../config.js';
import { loadExtensions } from '../modules/extensions/registry.js';
import { startGossipScheduler } from '../modules/federation/gossip.js';
import { loadOutboundTransports } from '../modules/messaging/transports.js';
import { startTopicGardenerScheduler } from '../modules/topics/gardenerSync.js';
import { initState, persistSettings } from '../infra/persistence/storage.js';
import { sendJson } from '../shared/utils/http.js';
import { cleanupTempUploads } from '../shared/utils/request.js';
import { routeRequest } from './router.js';

export async function startServer() {
  const state = await initState();
  const extensionList = state.settings?.extensions;
  state.uploadCleanup = state.settings?.uploadCleanup || state.uploadCleanup || {};
  state.extensions = await loadExtensions({
    list: extensionList,
    installations: state.settings?.extensionInstallations || [],
  });
  // wire outbound transports (email/SMS/webhook); defaults log-only if not configured
  state.outbound = await loadOutboundTransports();
  const uploadRetentionMs = MEDIA.uploadRetentionHours * 60 * 60 * 1000;
  const recordUploadCleanup = async ({ result, error, skippedReason } = {}) => {
    const now = new Date().toISOString();
    const prev = state.uploadCleanup || state.settings?.uploadCleanup || {};
    const next = { ...prev, lastRunAt: now };
    if (skippedReason) {
      next.lastSkippedAt = now;
      next.lastSkipReason = skippedReason;
    }
    if (result) {
      next.lastSuccessAt = now;
      next.lastResult = result;
      next.lastError = null;
      next.lastErrorAt = null;
    }
    if (error) {
      next.lastErrorAt = now;
      next.lastError = error?.message || String(error);
    }
    state.uploadCleanup = next;
    if (!state.settings) state.settings = {};
    state.settings.uploadCleanup = next;
    if (state.store?.saveSettings) {
      try {
        await persistSettings(state);
      } catch (persistError) {
        console.warn('[uploads] failed to persist cleanup stats', persistError);
      }
    }
  };
  const cleanupUploads = async () => {
    if (!Number.isFinite(uploadRetentionMs) || uploadRetentionMs <= 0) {
      await recordUploadCleanup({ skippedReason: 'retention_disabled' });
      return null;
    }
    try {
      const result = await cleanupTempUploads({ maxAgeMs: uploadRetentionMs });
      await recordUploadCleanup({ result });
      return result;
    } catch (error) {
      await recordUploadCleanup({ error });
      throw error;
    }
  };
  try {
    await cleanupUploads();
  } catch (error) {
    console.warn('[uploads] temp cleanup failed', error);
  }
  const cleanupIntervalMs = MEDIA.uploadCleanupIntervalMinutes * 60 * 1000;
  const shouldScheduleCleanup =
    Number.isFinite(cleanupIntervalMs) &&
    cleanupIntervalMs > 0 &&
    Number.isFinite(uploadRetentionMs) &&
    uploadRetentionMs > 0;
  if (shouldScheduleCleanup) {
    state.uploadCleanupInterval = setInterval(() => {
      cleanupUploads().catch((error) => {
        console.warn('[uploads] temp cleanup failed', error);
      });
    }, cleanupIntervalMs);
    state.uploadCleanupInterval.unref();
  }
  state.gossipStop = startGossipScheduler(state);
  state.topicGardenerStop = startTopicGardenerScheduler(state);

  const server = http.createServer((req, res) => {
    routeRequest(req, res, state).catch((error) => {
      if (error?.code === 'payload_too_large') {
        const maxBytes = Number.isFinite(error.maxBytes) ? error.maxBytes : REQUEST_BODY.maxBytes;
        const limitLabel =
          Number.isFinite(maxBytes) && maxBytes >= 1024 * 1024
            ? `${Math.round((maxBytes / (1024 * 1024)) * 10) / 10}MB`
            : `${Math.round(maxBytes / 1024)}KB`;
        return sendJson(res, 413, {
          error: 'payload_too_large',
          message: `Request exceeds the ${limitLabel} limit.`,
          maxBytes,
        });
      }
      if (error?.code === 'multipart_not_supported') {
        return sendJson(res, 415, {
          error: 'multipart_not_supported',
          message: 'Multipart form data is not supported for this endpoint.',
        });
      }
      console.error(error);
      return sendJson(res, 500, { error: 'internal_error', detail: error.message });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Organization Web server running at http://${HOST}:${PORT}`);
  });
}
