
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
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

// In-memory prototypes for the Party Circle foundation.
const uniquenessLedger = new Set(); // hashed PIDs across the "Circle"
const sessions = new Map(); // sessionId -> { status, issuedAt, salt, hash? }
const peers = new Set(); // placeholder for trusted providers to gossip with

const PUBLIC_ROOT = new URL('./public', import.meta.url).pathname;
const TEMPLATE_ROOT = join(PUBLIC_ROOT, 'templates');
const templateCache = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = await renderPage('home', { ledgerSize: uniquenessLedger.size }, { wantsPartial, title: 'Representative Party' });
      return sendHtml(res, html);
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        ledger: uniquenessLedger.size,
        sessions: sessions.size,
        peers: peers.size,
        now: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/auth/eudi') {
      const sessionId = randomUUID();
      const baseUrl = deriveBaseUrl(req);
      const salt = randomUUID().replace(/-/g, '');
      sessions.set(sessionId, { status: 'pending', issuedAt: Date.now(), salt });
      const deepLink = buildDeepLink({ sessionId, baseUrl });
      const html = await renderPage(
        'auth-eudi',
        { sessionId, deepLink, demoHash: `demo-${sessionId.slice(0, 6)}` },
        { wantsPartial, title: 'EUDI Wallet Handshake' },
      );
      return sendHtml(res, html);
    }

    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      return await handleAuthCallback({ url, res, wantsPartial });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
      return serveStatic(res, url.pathname);
    }

    sendNotFound(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'internal_error', detail: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Representative Party server running at http://${HOST}:${PORT}`);
});

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

function buildDeepLink({ sessionId, baseUrl }) {
  const callback = `${baseUrl}/auth/callback?session=${sessionId}`;
  return `openid-credential-offer://?client_id=representative-party&session_id=${sessionId}&redirect_uri=${encodeURIComponent(
    callback,
  )}`;
}

async function handleAuthCallback({ url, res, wantsPartial }) {
  const sessionId = url.searchParams.get('session');
  const rawPid = url.searchParams.get('pid');
  const providedHash = url.searchParams.get('pidHash');

  if (!sessionId || !sessions.has(sessionId)) {
    const html = await renderPage(
      'error',
      { message: 'Missing or unknown session. Restart the EUDI flow.' },
      { wantsPartial, title: 'Invalid Session' },
    );
    return sendHtml(res, html);
  }

  const session = sessions.get(sessionId);

  if (!rawPid && !providedHash) {
    const html = await renderPage(
      'error',
      { message: 'No PID provided. The Verifiable Presentation is missing the subject.' },
      { wantsPartial, title: 'Invalid PID' },
    );
    return sendHtml(res, html);
  }

  const pidHash = providedHash || blindHash(rawPid, session.salt);
  uniquenessLedger.add(pidHash);
  sessions.set(sessionId, { ...session, status: 'verified', pidHash });

  const html = await renderPage(
    'verification-complete',
    { pidHashShort: pidHash.slice(0, 8) },
    { wantsPartial, title: 'Citizen Verified' },
  );
  return sendHtml(res, html);
}

function blindHash(pid, salt) {
  return createHash('sha256').update(`${pid}:${salt}`).digest('hex');
}

async function renderPage(templateName, data = {}, { wantsPartial = false, title = 'Representative Party' } = {}) {
  const bodyTemplate = await loadTemplate(templateName);
  const body = applyTemplate(bodyTemplate, data);
  if (wantsPartial) return body;
  const layout = await loadTemplate('layout');
  return applyTemplate(layout, { ...data, body, title });
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
