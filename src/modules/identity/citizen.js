import { parseCookies } from '../../shared/utils/request.js';

export function getPerson(req, state) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get('circle_session');
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session || session.status !== 'verified' || !session.pidHash) return null;
  const handle = session.handle || (session.pidHash ? `person-${session.pidHash.slice(0, 8)}` : `session-${sessionId.slice(0, 8)}`);
  const role = session.role || 'person';
  return {
    ...session,
    sessionId,
    role,
    banned: Boolean(session.banned),
    handle,
  };
}
