import { randomUUID } from 'node:crypto';

import { createActor } from '../services/activitypub.js';
import { buildCredentialOffer, buildSessionCookie, blindHash } from '../services/auth.js';
import { deriveBaseUrl } from '../utils/request.js';
import { sendHtml } from '../utils/http.js';
import { persistActors, persistLedger, persistSessions } from '../state/storage.js';
import { renderPage } from '../views/templates.js';

export async function startAuth({ req, res, state, wantsPartial }) {
  const sessionId = randomUUID();
  const baseUrl = deriveBaseUrl(req);
  const salt = randomUUID().replace(/-/g, '');
  const offer = buildCredentialOffer({ sessionId, baseUrl });

  state.sessions.set(sessionId, { id: sessionId, status: 'pending', issuedAt: Date.now(), salt, offer });
  await persistSessions(state);

  const html = await renderPage(
    'auth-eudi',
    {
      sessionId,
      deepLink: offer.deepLink,
      qrUrl: offer.qrUrl,
      demoHash: `demo-${sessionId.slice(0, 6)}`,
      offerPreview: offer.preview,
    },
    { wantsPartial, title: 'EUDI Wallet Handshake' },
  );
  return sendHtml(res, html);
}

export async function completeAuth({ req, res, url, state, wantsPartial }) {
  const sessionId = url.searchParams.get('session');
  const rawPid = url.searchParams.get('pid');
  const providedHash = url.searchParams.get('pidHash') || url.searchParams.get('vp_token');

  if (!sessionId || !state.sessions.has(sessionId)) {
    const html = await renderPage(
      'error',
      { message: 'Missing or unknown session. Restart the EUDI flow.' },
      { wantsPartial, title: 'Invalid Session' },
    );
    return sendHtml(res, html);
  }

  const session = state.sessions.get(sessionId);

  if (!rawPid && !providedHash) {
    const html = await renderPage(
      'error',
      { message: 'No PID provided. The Verifiable Presentation is missing the subject.' },
      { wantsPartial, title: 'Invalid PID' },
    );
    return sendHtml(res, html);
  }

  const pidHash = providedHash || blindHash(rawPid, session.salt);
  const alreadyKnown = state.uniquenessLedger.has(pidHash);
  state.uniquenessLedger.add(pidHash);
  await persistLedger(state);

  const baseUrl = deriveBaseUrl(req);
  const actor = state.actors.get(pidHash) || createActor({ pidHash, baseUrl });
  state.actors.set(pidHash, actor);
  await persistActors(state);

  state.sessions.set(sessionId, { ...session, status: 'verified', pidHash, verifiedAt: Date.now(), actorId: actor.id });
  await persistSessions(state);

  const ledgerNote = alreadyKnown ? 'Ledger entry already present (peer sync).' : 'New entry added to the Uniqueness Ledger.';
  const html = await renderPage(
    'verification-complete',
    { pidHashShort: pidHash.slice(0, 8), ledgerNote, actorId: actor.id },
    { wantsPartial, title: 'Citizen Verified' },
  );

  const cookie = buildSessionCookie(sessionId);
  return sendHtml(res, html, { 'Set-Cookie': cookie });
}
