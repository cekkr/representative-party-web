import { fetchText } from './http.js';

export async function createVerifiedSession(baseUrl, { pidHash } = {}) {
  const { text } = await fetchText(`${baseUrl}/auth/eudi`);
  const match = text.match(/\/auth\/callback\?session=([^&"]+)&pidHash=([^"&]+)/);
  if (!match) {
    throw new Error('Failed to parse auth callback link');
  }
  const sessionId = match[1];
  const fallbackHash = match[2];
  const finalHash = pidHash || fallbackHash;
  const callbackUrl = `${baseUrl}/auth/callback?session=${sessionId}&pidHash=${encodeURIComponent(finalHash)}`;
  const response = await fetch(callbackUrl);
  const cookieHeader = response.headers.get('set-cookie');
  if (!cookieHeader) {
    throw new Error('Auth callback did not set session cookie');
  }
  const cookie = cookieHeader.split(';')[0];
  return { sessionId, pidHash: finalHash, cookie };
}

export function extractSessionId(cookie = '') {
  const match = cookie.match(/circle_session=([^;]+)/);
  return match ? match[1] : null;
}
