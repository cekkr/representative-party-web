import { randomUUID } from 'node:crypto';

import { createActor } from '../../modules/federation/activitypub.js';
import { buildCredentialOffer, buildSessionCookie, blindHash } from '../../modules/identity/auth.js';
import { getCitizen } from '../../modules/identity/citizen.js';
import { getCirclePolicyState } from '../../modules/circle/policy.js';
import { deriveBaseUrl } from '../../shared/utils/request.js';
import { sendHtml } from '../../shared/utils/http.js';
import { persistActors, persistLedger, persistSessions } from '../../infra/persistence/storage.js';
import { renderPage } from '../views/templates.js';

export async function startAuth({ req, res, state, wantsPartial }) {
  const baseUrl = deriveBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const resumeId = url.searchParams.get('session');
  const existing = resumeId ? state.sessions.get(resumeId) : null;
  const citizen = getCitizen(req, state);
  const policy = getCirclePolicyState(state);

  if (existing && existing.status === 'verified') {
    const html = await renderPage(
      'verification-complete',
      {
        pidHashShort: existing.pidHash?.slice(0, 8) || 'verified',
        ledgerNote: 'Session already verified. Hash present in the Uniqueness Ledger.',
        actorId: existing.actorId || 'actor-resumed',
      },
      { wantsPartial, title: 'Citizen Verified' },
    );
    const cookie = buildSessionCookie(existing.id);
    return sendHtml(res, html, { 'Set-Cookie': cookie });
  }

  const shouldResume = Boolean(existing && existing.status === 'pending');
  const sessionId = shouldResume ? existing.id : randomUUID();
  const salt = shouldResume ? existing.salt : randomUUID().replace(/-/g, '');
  const offer = buildCredentialOffer({ sessionId, baseUrl });

  state.sessions.set(sessionId, {
    id: sessionId,
    status: 'pending',
    issuedAt: shouldResume ? existing.issuedAt : Date.now(),
    salt,
    offer,
    role: existing?.role || 'citizen',
    banned: existing?.banned || false,
  });
  await persistSessions(state);

  const html = await renderPage(
    'auth-eudi',
    {
      sessionId,
      deepLink: offer.deepLink,
      qrUrl: offer.qrUrl,
      demoHash: `demo-${sessionId.slice(0, 6)}`,
      offerPreview: offer.preview,
      hashOnlyMessage: 'Hash-only guarantee: we persist only a blinded PID hash tied to a session salt.',
      resumeHint: shouldResume
        ? 'Resuming pending session; QR and deep link refreshed for the same blinded hash.'
        : 'New session issued; use QR or deep link to finish wallet handoff.',
      policyNote:
        policy.enforcement === 'strict'
          ? 'Circle enforcement active: verification required to post or vote.'
          : 'Circle observing mode: verification encouraged for accountability.',
      citizenHandle: citizen?.handle,
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

  const handle = session.handle || `citizen-${pidHash.slice(0, 8)}`;
  const role = session.role || 'citizen';
  const banned = Boolean(session.banned);

  state.sessions.set(sessionId, {
    ...session,
    status: 'verified',
    pidHash,
    verifiedAt: Date.now(),
    actorId: actor.id,
    handle,
    role,
    banned,
  });
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
