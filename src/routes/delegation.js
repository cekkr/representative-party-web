import { getCitizen } from '../services/citizen.js';
import { chooseDelegation } from '../services/delegation.js';
import { sendJson } from '../utils/http.js';
import { readRequestBody } from '../utils/request.js';
import { sanitizeText } from '../utils/text.js';

export async function resolveConflict({ req, res, state }) {
  const citizen = getCitizen(req, state);
  const body = await readRequestBody(req);
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate' });
  }
  await chooseDelegation({ citizen, topic, delegateHash, state });
  return sendJson(res, 200, { status: 'ok', topic, delegateHash });
}
