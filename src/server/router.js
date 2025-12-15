import { URL } from 'node:url';

import { serveActor, inbox } from '../routes/activitypub.js';
import { completeAuth, startAuth } from '../routes/auth.js';
import { handleGossip, exportLedger, listPeers, registerPeer } from '../routes/circle.js';
import { renderDiscussion, postDiscussion } from '../routes/discussion.js';
import { renderPetitions, submitPetition, castVote } from '../routes/petitions.js';
import { renderHealth } from '../routes/health.js';
import { renderHome } from '../routes/home.js';
import { servePublic } from '../routes/static.js';
import { renderAdmin, updateAdmin } from '../routes/admin.js';
import { getExtensions, toggleExtension } from '../routes/extensions.js';
import { sendNotFound } from '../utils/http.js';

export async function routeRequest(req, res, state) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';

  if (req.method === 'GET' && url.pathname === '/') {
    return renderHome({ req, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return renderHealth({ res, state });
  }

  if (req.method === 'GET' && url.pathname === '/auth/eudi') {
    return startAuth({ req, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    return completeAuth({ req, res, url, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/discussion') {
    return renderDiscussion({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/discussion') {
    return postDiscussion({ req, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/petitions') {
    return renderPetitions({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/petitions') {
    return submitPetition({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/petitions/vote') {
    return castVote({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/circle/gossip') {
    return handleGossip({ req, res, state });
  }

  if (req.method === 'GET' && url.pathname === '/circle/ledger') {
    return exportLedger({ res, state });
  }

  if (req.method === 'GET' && url.pathname === '/circle/peers') {
    return listPeers({ res, state });
  }

  if (req.method === 'POST' && url.pathname === '/circle/peers') {
    return registerPeer({ req, res, state });
  }

  if (req.method === 'GET' && url.pathname === '/admin') {
    return renderAdmin({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/admin') {
    return updateAdmin({ req, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/extensions') {
    return getExtensions({ res, state });
  }

  if (req.method === 'POST' && url.pathname === '/extensions') {
    return toggleExtension({ req, res, state });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/ap/actors/')) {
    const segments = url.pathname.split('/').filter(Boolean);
    const hash = segments[segments.length - 1];
    return serveActor({ res, state, hash });
  }

  if (req.method === 'POST' && url.pathname === '/ap/inbox') {
    return inbox({ req, res });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    return servePublic({ res, pathname: url.pathname });
  }

  return sendNotFound(res);
}
