import { createHash } from 'node:crypto';

export function buildCredentialOffer({ sessionId, baseUrl }) {
  const callback = `${baseUrl}/auth/callback?session=${sessionId}`;
  const presentationDefinition = {
    id: 'eudi_pid_unique',
    input_descriptors: [
      {
        id: 'pid_hash',
        name: 'Pseudonymous Identifier',
        purpose: 'Prove you are a unique citizen without revealing identity',
        constraints: { fields: [{ path: ['$.sub'], filter: { type: 'string' } }] },
      },
    ],
  };

  const offer = {
    session_id: sessionId,
    client_id: `${baseUrl}/auth/eudi`,
    redirect_uri: callback,
    scopes: ['openid', 'profile'],
    response_type: 'vp_token',
    response_mode: 'direct_post.jwt',
    presentation_definition: presentationDefinition,
  };

  const offerString = JSON.stringify(offer);
  const preview = JSON.stringify(offer, null, 2);
  const deepLink = `openid-credential-offer://?credential_offer=${encodeURIComponent(offerString)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(deepLink)}`;

  return { deepLink, qrUrl, preview };
}

export function blindHash(pid, salt) {
  return createHash('sha256').update(`${pid}:${salt}`).digest('hex');
}

export function buildSessionCookie(sessionId) {
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  return `circle_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
