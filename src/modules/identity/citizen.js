import { parseCookies } from '../../shared/utils/request.js';
import { resolveDefaultActorRole } from '../circle/policy.js';

export function getPerson(req, state) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get('circle_session');
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session || session.status !== 'verified' || !session.pidHash) return null;
  const defaultRole = resolveDefaultActorRole(state);
  const role = session.role || defaultRole;
  const handlePrefix = role === 'user' || role === 'person' ? role : defaultRole;
  const handle =
    session.handle ||
    (session.pidHash ? `${handlePrefix}-${session.pidHash.slice(0, 8)}` : `session-${sessionId.slice(0, 8)}`);
  return {
    ...session,
    sessionId,
    role,
    banned: Boolean(session.banned),
    handle,
  };
}
