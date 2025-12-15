
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { URL } from 'node:url';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.html': 'text/html',
  '.txt': 'text/plain',
};
const POLICIES = {
  requireVerification: true,
  enforceCircle: process.env.ENFORCE_CIRCLE === 'true',
};
const PUBLIC_ROOT = new URL('./public', import.meta.url).pathname;
const TEMPLATE_ROOT = join(PUBLIC_ROOT, 'templates');
const DATA_ROOT = new URL('./data', import.meta.url).pathname;
const FILES = {
  ledger: join(DATA_ROOT, 'ledger.json'),
  sessions: join(DATA_ROOT, 'sessions.json'),
  peers: join(DATA_ROOT, 'peers.json'),
  discussions: join(DATA_ROOT, 'discussions.json'),
  actors: join(DATA_ROOT, 'actors.json'),
};
const templateCache = new Map();

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});

async function bootstrap() {
  await mkdir(DATA_ROOT, { recursive: true });
  const state = await loadState();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, state).catch((error) => {
      console.error(error);
      sendJson(res, 500, { error: 'internal_error', detail: error.message });
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Representative Party server running at http://${HOST}:${PORT}`);
  });
}

async function handleRequest(req, res, state) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';

  if (req.method === 'GET' && url.pathname === '/') {
    const citizen = getCitizen(req, state);
    const html = await renderPage(
      'home',
      {
        ledgerSize: state.uniquenessLedger.size,
        actorCount: state.actors.size,
        discussionCount: state.discussions.length,
        citizenHandle: citizen?.handle,
        policyFlag: POLICIES.enforceCircle ? 'Circle enforcement on' : 'Circle policy open',
      },
      { wantsPartial, title: 'Representative Party' },
    );
    return sendHtml(res, html);
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      ledger: state.uniquenessLedger.size,
      sessions: state.sessions.size,
      peers: state.peers.size,
      actors: state.actors.size,
      discussions: state.discussions.length,
      policies: POLICIES,
      now: new Date().toISOString(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/auth/eudi') {
    return handleAuthStart({ req, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    return handleAuthCallback({ req, url, res, state, wantsPartial });
  }

  if (req.method === 'GET' && url.pathname === '/discussion') {
    return handleDiscussionPage({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/discussion') {
    return handleDiscussionPost({ req, res, state, wantsPartial });
  }

  if (req.method === 'POST' && url.pathname === '/circle/gossip') {
    return handleGossip({ req, res, state });
  }

  if (req.method === 'GET' && url.pathname === '/circle/ledger') {
    return sendJson(res, 200, { entries: [...state.uniquenessLedger] });
  }

  if (req.method === 'GET' && url.pathname === '/circle/peers') {
    return sendJson(res, 200, { peers: [...state.peers] });
  }

  if (req.method === 'POST' && url.pathname === '/circle/peers') {
    const body = await readRequestBody(req);
    if (body.peer) {
      state.peers.add(String(body.peer));
      await persistPeers(state);
    }
    return sendJson(res, 200, { peers: [...state.peers] });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/ap/actors/')) {
    const segments = url.pathname.split('/').filter(Boolean);
    const hash = segments[segments.length - 1];
    const actor = state.actors.get(hash);
    if (!actor) return sendNotFound(res);
    return sendJson(res, 200, actor);
  }

  if (req.method === 'POST' && url.pathname === '/ap/inbox') {
    // Placeholder inbox for ActivityPub federation.
    const body = await readRequestBody(req);
    return sendJson(res, 202, { status: 'accepted', received: body });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    return serveStatic(res, url.pathname);
  }

  sendNotFound(res);
}

async function handleAuthStart({ req, res, state, wantsPartial }) {
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

async function handleAuthCallback({ req, url, res, state, wantsPartial }) {
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

async function handleDiscussionPage({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  const html = await renderPage(
    'discussion',
    {
      ledgerSize: state.uniquenessLedger.size,
      citizenHandle: citizen?.handle || 'Not verified yet',
      citizenStatus: citizen ? 'Posting as verified citizen bound to a blinded PID hash.' : 'Start the wallet flow to post with accountability.',
      discussionList: renderDiscussionList(state.discussions),
      verificationPolicy: POLICIES.requireVerification
        ? 'Wallet verification required to post.'
        : 'Open posting allowed (demo mode).',
    },
    { wantsPartial, title: 'Deliberation Sandbox' },
  );
  return sendHtml(res, html);
}

async function handleDiscussionPost({ req, res, state, wantsPartial }) {
  const citizen = getCitizen(req, state);
  if (POLICIES.requireVerification && !citizen) {
    return sendJson(res, 401, { error: 'verification_required' });
  }

  const body = await readRequestBody(req);
  const topic = sanitizeText(body.topic || 'General', 80);
  const stance = sanitizeText(body.stance || 'neutral', 40);
  const content = sanitizeText(body.content || '', 800);

  if (!content) {
    return sendJson(res, 400, { error: 'missing_content' });
  }

  const entry = {
    id: randomUUID(),
    topic,
    stance,
    content,
    authorHash: citizen?.pidHash || 'anonymous',
    createdAt: new Date().toISOString(),
  };
  state.discussions.unshift(entry);
  await persistDiscussions(state);

  if (wantsPartial) {
    const html = await renderPage(
      'discussion',
      {
        ledgerSize: state.uniquenessLedger.size,
        citizenHandle: citizen?.handle || 'Not verified yet',
        citizenStatus: citizen ? 'Posting as verified citizen bound to a blinded PID hash.' : 'Start the wallet flow to post with accountability.',
        discussionList: renderDiscussionList(state.discussions),
        verificationPolicy: POLICIES.requireVerification
          ? 'Wallet verification required to post.'
          : 'Open posting allowed (demo mode).',
      },
      { wantsPartial, title: 'Deliberation Sandbox' },
    );
    return sendHtml(res, html);
  }

  return sendRedirect(res, '/discussion');
}

async function handleGossip({ req, res, state }) {
  const body = await readRequestBody(req);
  const hashes = Array.isArray(body.hashes) ? body.hashes : [];
  let added = 0;
  for (const hash of hashes) {
    if (!state.uniquenessLedger.has(hash)) {
      state.uniquenessLedger.add(hash);
      added += 1;
    }
  }
  if (body.peer) {
    state.peers.add(String(body.peer));
    await persistPeers(state);
  }
  if (added > 0) {
    await persistLedger(state);
  }
  return sendJson(res, 200, { added, total: state.uniquenessLedger.size, peers: [...state.peers] });
}

function sendHtml(res, html, headers = {}, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

async function serveStatic(res, pathname) {
  const safePath = pathname.replace(/^\/public\//, '');
  const filePath = join(PUBLIC_ROOT, safePath);
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    return sendNotFound(res);
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return sendNotFound(res);
    }
    const content = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return sendNotFound(res);
    throw error;
  }
}

function deriveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function buildCredentialOffer({ sessionId, baseUrl }) {
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

function blindHash(pid, salt) {
  return createHash('sha256').update(`${pid}:${salt}`).digest('hex');
}

function buildSessionCookie(sessionId) {
  const maxAge = 60 * 60 * 24 * 7; // 7 days
  return `circle_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

async function renderPage(templateName, data = {}, { wantsPartial = false, title = 'Representative Party' } = {}) {
  const bodyTemplate = await loadTemplate(templateName);
  const body = applyTemplate(bodyTemplate, data);
  if (wantsPartial) return body;
  const layout = await loadTemplate('layout');
  const layoutData = { ...data, body, title };
  if (!layoutData.citizenHandle) {
    layoutData.citizenHandle = 'Guest session';
  }
  return applyTemplate(layout, layoutData);
}

async function loadTemplate(name) {
  if (templateCache.has(name)) {
    return templateCache.get(name);
  }
  const filePath = join(TEMPLATE_ROOT, `${name}.html`);
  const content = await readFile(filePath, 'utf-8');
  templateCache.set(name, content);
  return content;
}

function applyTemplate(template, data) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

async function loadState() {
  const uniquenessLedger = new Set(await readJson(FILES.ledger, []));
  const sessions = new Map((await readJson(FILES.sessions, [])).map((session) => [session.id, session]));
  const peers = new Set(await readJson(FILES.peers, []));
  const discussions = await readJson(FILES.discussions, []);
  const actors = new Map((await readJson(FILES.actors, [])).map((actor) => [actor.hash, actor]));
  return { uniquenessLedger, sessions, peers, discussions, actors };
}

async function persistLedger(state) {
  await writeJson(FILES.ledger, [...state.uniquenessLedger]);
}

async function persistSessions(state) {
  await writeJson(FILES.sessions, [...state.sessions.values()]);
}

async function persistPeers(state) {
  await writeJson(FILES.peers, [...state.peers]);
}

async function persistDiscussions(state) {
  await writeJson(FILES.discussions, state.discussions);
}

async function persistActors(state) {
  await writeJson(FILES.actors, [...state.actors.values()]);
}

async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  const type = req.headers['content-type'] || '';
  if (!raw) return {};

  if (type.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  }

  if (type.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }

  return { raw };
}

function parseCookies(header) {
  const cookies = new Map();
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (!key) return;
    const value = rest.join('=');
    cookies.set(key, decodeURIComponent(value));
  });
  return cookies;
}

function getCitizen(req, state) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.get('circle_session');
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session || session.status !== 'verified' || !session.pidHash) return null;
  return { ...session, sessionId, handle: `citizen-${session.pidHash.slice(0, 8)}` };
}

function sanitizeText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, maxLength);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDiscussionList(entries) {
  if (!entries.length) {
    return '<p class="muted">No contributions yet. Be the first to start the debate.</p>';
  }

  return entries
    .map((entry) => {
      return `
        <article class="discussion">
          <div class="discussion__meta">
            <span class="pill">${escapeHtml(entry.topic)}</span>
            <span class="pill ghost">${escapeHtml(entry.stance)}</span>
            <span class="muted small">${new Date(entry.createdAt).toLocaleString()}</span>
          </div>
          <p>${escapeHtml(entry.content)}</p>
          <p class="muted small">Author hash: ${escapeHtml(entry.authorHash)}</p>
        </article>
      `;
    })
    .join('\n');
}

function createActor({ pidHash, baseUrl }) {
  const id = `${baseUrl}/ap/actors/${pidHash}`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Person',
    preferredUsername: pidHash.slice(0, 12),
    inbox: `${baseUrl}/ap/inbox`,
    outbox: `${baseUrl}/ap/outbox`,
    hash: pidHash,
    published: new Date().toISOString(),
  };
}

function sendRedirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}
