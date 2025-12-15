import { sendJson, sendNotFound } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';

export function serveActor({ res, state, hash }) {
  const actor = state.actors.get(hash);
  if (!actor) return sendNotFound(res);
  return sendJson(res, 200, actor);
}

export async function inbox({ req, res }) {
  const body = await readRequestBody(req);
  return sendJson(res, 202, { status: 'accepted', received: body });
}
