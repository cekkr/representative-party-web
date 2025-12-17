import http from 'node:http';

import { HOST, PORT } from '../config.js';
import { loadExtensions } from '../modules/extensions/registry.js';
import { loadOutboundTransports } from '../modules/messaging/transports.js';
import { initState } from '../infra/persistence/storage.js';
import { sendJson } from '../shared/utils/http.js';
import { routeRequest } from './router.js';

export async function startServer() {
  const state = await initState();
  const extensionList = state.settings?.extensions;
  state.extensions = await loadExtensions({ list: extensionList });
  // wire outbound transports (email/SMS/webhook); defaults log-only if not configured
  state.outbound = await loadOutboundTransports();

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
