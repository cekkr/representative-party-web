import { getCitizen } from '../../modules/identity/citizen.js';
import { chooseDelegation } from '../../modules/delegation/delegation.js';
import { sendJson } from '../../shared/utils/http.js';
import { readRequestBody } from '../../shared/utils/request.js';
import { sanitizeText } from '../../shared/utils/text.js';

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
