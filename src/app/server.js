import http from 'node:http';

import { HOST, MEDIA, PORT } from '../config.js';
import { loadExtensions } from '../modules/extensions/registry.js';
import { startGossipScheduler } from '../modules/federation/gossip.js';
import { loadOutboundTransports } from '../modules/messaging/transports.js';
import { startTopicGardenerScheduler } from '../modules/topics/gardenerSync.js';
import { initState } from '../infra/persistence/storage.js';
import { sendJson } from '../shared/utils/http.js';
import { cleanupTempUploads } from '../shared/utils/request.js';
import { routeRequest } from './router.js';

export async function startServer() {
  const state = await initState();
  const extensionList = state.settings?.extensions;
  state.extensions = await loadExtensions({ list: extensionList });
  // wire outbound transports (email/SMS/webhook); defaults log-only if not configured
  state.outbound = await loadOutboundTransports();
  const uploadRetentionMs = MEDIA.uploadRetentionHours * 60 * 60 * 1000;
  const cleanupUploads = async () => {
    if (!Number.isFinite(uploadRetentionMs) || uploadRetentionMs <= 0) return;
    await cleanupTempUploads({ maxAgeMs: uploadRetentionMs });
  };
  try {
    await cleanupUploads();
  } catch (error) {
    console.warn('[uploads] temp cleanup failed', error);
  }
  const cleanupIntervalMs = MEDIA.uploadCleanupIntervalMinutes * 60 * 1000;
  if (Number.isFinite(cleanupIntervalMs) && cleanupIntervalMs > 0) {
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
      console.error(error);
      sendJson(res, 500, { error: 'internal_error', detail: error.message });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Representative Party server running at http://${HOST}:${PORT}`);
  });
}
