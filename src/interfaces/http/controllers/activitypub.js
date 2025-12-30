import { sendJson, sendNotFound } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export function serveActor({ res, state, hash }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const actor = state.actors.get(hash);
  if (!actor) return sendNotFound(res);
  return sendJson(res, 200, actor);
}

export async function inbox({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const body = await readRequestBody(req);
  return sendJson(res, 202, { status: 'accepted', received: body });
}
