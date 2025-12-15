import http from 'node:http';

import { HOST, PORT } from '../config.js';
import { initState } from '../state/storage.js';
import { sendJson } from '../utils/http.js';
import { routeRequest } from './router.js';

export async function startServer() {
  const state = await initState();

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
