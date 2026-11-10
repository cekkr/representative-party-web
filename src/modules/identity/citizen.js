import { parseCookies } from '../../shared/utils/request.js';
import { resolveDefaultActorRole } from '../circle/policy.js';
import { findSessionByHash, isChosenHandle, isIdentityBanned } from './sessions.js';

export function getPerson(req, state) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get('circle_session');
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session || session.status !== 'verified' || !session.pidHash) return null;
  const defaultRole = resolveDefaultActorRole(state);
  const role = session.role || defaultRole;
  const handlePrefix = role === 'user' || role === 'person' ? role : defaultRole;
  // Identity-level standing wins over a session that predates it: the chosen
  // handle of the person, and a ban on any of their sessions.
  const identityHandle = isChosenHandle(session.handle, session.pidHash) ? '' : findSessionByHash(state, session.pidHash)?.handle;
  const handle =
    (isChosenHandle(identityHandle, session.pidHash) && identityHandle) ||
    session.handle ||
    (session.pidHash ? `${handlePrefix}-${session.pidHash.slice(0, 8)}` : `session-${sessionId.slice(0, 8)}`);
  return {
    ...session,
    sessionId,
    role,
    banned: Boolean(session.banned) || isIdentityBanned(state, session.pidHash),
    handle,
  };
}
