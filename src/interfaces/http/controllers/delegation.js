import { getPerson } from '../../../modules/identity/person.js';
import { chooseDelegation } from '../../../modules/delegation/delegation.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { sendJson } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export async function resolveConflict({ req, res, state }) {
  if (!isModuleEnabled(state, 'delegation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'delegation' });
  }
  const person = getPerson(req, state);
  const body = await readRequestBody(req);
  const topic = sanitizeText(body.topic || 'general', 64);
  const delegateHash = sanitizeText(body.delegateHash || '', 80);
  if (!delegateHash) {
    return sendJson(res, 400, { error: 'missing_delegate' });
  }
  await chooseDelegation({ person, topic, delegateHash, state });
  await logTransaction(state, {
    type: 'delegation_set',
    actorHash: person?.pidHash || 'anonymous',
    payload: { topic, delegateHash },
  });
  return sendJson(res, 200, { status: 'ok', topic, delegateHash });
}
