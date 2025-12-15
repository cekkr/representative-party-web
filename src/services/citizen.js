import { parseCookies } from '../utils/request.js';

export function getCitizen(req, state) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get('circle_session');
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session || session.status !== 'verified' || !session.pidHash) return null;
  return { ...session, sessionId, handle: `citizen-${session.pidHash.slice(0, 8)}` };
}
