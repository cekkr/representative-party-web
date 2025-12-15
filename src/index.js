
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const body = renderHome({ ledgerSize: uniquenessLedger.size });
      return sendHtml(res, body, { wantsPartial, title: 'Representative Party' });
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
      const body = renderAuthPage({ sessionId, deepLink });
      return sendHtml(res, body, { wantsPartial, title: 'EUDI Wallet Handshake' });
    }

    if (req.method === 'GET' && url.pathname === '/auth/callback') {
      return handleAuthCallback({ url, res, wantsPartial });
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

function sendHtml(res, body, { wantsPartial = false, title = 'Representative Party' } = {}) {
  const html = wantsPartial ? body : renderLayout({ title, body });
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
  const safePath = pathname.replace('/public/', '');
  const filePath = join(PUBLIC_ROOT, safePath);

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

function handleAuthCallback({ url, res, wantsPartial }) {
  const sessionId = url.searchParams.get('session');
  const rawPid = url.searchParams.get('pid');
  const providedHash = url.searchParams.get('pidHash');

  if (!sessionId || !sessions.has(sessionId)) {
    const body = renderErrorPage('Missing or unknown session. Restart the EUDI flow.');
    return sendHtml(res, body, { wantsPartial, title: 'Invalid Session' });
  }

  const session = sessions.get(sessionId);

  if (!rawPid && !providedHash) {
    const body = renderErrorPage('No PID provided. The Verifiable Presentation is missing the subject.');
    return sendHtml(res, body, { wantsPartial, title: 'Invalid PID' });
  }

  const pidHash = providedHash || blindHash(rawPid, session.salt);
  uniquenessLedger.add(pidHash);
  sessions.set(sessionId, { ...session, status: 'verified', pidHash });

  const body = renderVerificationComplete({ pidHash });
  return sendHtml(res, body, { wantsPartial, title: 'Citizen Verified' });
}

function blindHash(pid, salt) {
  return createHash('sha256').update(`${pid}:${salt}`).digest('hex');
}

function renderLayout({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/public/app.css" />
</head>
<body>
  <header class="hero">
    <div class="hero__brand">
      <div class="orb"></div>
      <div>
        <p class="eyebrow">Representative Party Framework</p>
        <h1>Party Circle</h1>
        <p class="tagline">Phase 1 foundation: verifiable, federated, citizen-first access.</p>
      </div>
    </div>
    <nav class="hero__nav">
      <a href="/" data-partial>Home</a>
      <a href="/auth/eudi" data-partial>Wallet Login (demo)</a>
      <a href="/health" target="_blank" rel="noreferrer">Health</a>
    </nav>
  </header>
  <main data-shell>${body}</main>
  <footer class="footer">
    <span>Vanilla SSR + Party Circle kernel prototype</span>
  </footer>

  <script>
    // Lightweight router interceptor for partial HTML swaps.
    (() => {
      const root = document.querySelector('[data-shell]');
      if (!root) return;

      document.addEventListener('click', async (event) => {
        const anchor = event.target.closest('a[data-partial]');
        if (!anchor) return;
        const url = anchor.href;
        if (!url.startsWith(window.location.origin)) return;
        event.preventDefault();
        try {
          const response = await fetch(url, { headers: { 'X-Requested-With': 'partial' } });
          if (!response.ok) throw new Error('Navigation failed');
          const html = await response.text();
          root.innerHTML = html;
          window.history.pushState({}, '', url);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          triggerDeepLink();
        } catch (error) {
          console.error(error);
          window.location.href = url;
        }
      });

      window.addEventListener('popstate', () => window.location.reload());
    })();

    // Deep link trigger for the mock OIDC4VP handoff.
    function triggerDeepLink() {
      const target = document.querySelector('[data-deep-link]');
      if (!target) return;
      const href = target.dataset.deepLink;
      const fallback = document.querySelector('[data-deep-link-fallback]');
      if (fallback) fallback.textContent = href;
      setTimeout(() => {
        window.location.href = href;
      }, 250);
    }

    triggerDeepLink();
  </script>
</body>
</html>`;
}

function renderHome({ ledgerSize }) {
  return `
    <section class="panel">
      <div>
        <p class="eyebrow">Phase 1 — Party Circle foundation</p>
        <h2>Verifier-first onboarding for unique citizens</h2>
        <p>The server issues an OIDC4VP credential offer, receives a blinded PID hash, and seeds the Uniqueness Ledger. Everything here is server-rendered and progressively enhanced with vanilla JS.</p>
        <div class="cta-row">
          <a class="cta" href="/auth/eudi" data-partial>Login with EU Wallet (demo)</a>
          <a class="ghost" href="/health" target="_blank" rel="noreferrer">Health endpoint</a>
        </div>
      </div>
      <div class="stat">
        <p class="eyebrow">Uniqueness ledger</p>
        <p class="stat__value">${ledgerSize}</p>
        <p class="muted">Hashed citizen identities tracked in-memory.</p>
      </div>
    </section>

    <section class="panel grid">
      <div>
        <p class="eyebrow">Kernel</p>
        <h3>Party Circle</h3>
        <ul class="plain">
          <li>OIDC4VP verifier entry point with blinded PID hashing</li>
          <li>Ledger to prevent duplicate registrations across peers</li>
          <li>Trusted peers placeholder ready for ActivityPub gossip</li>
        </ul>
      </div>
      <div>
        <p class="eyebrow">Frontend</p>
        <h3>SSR + Vanilla router</h3>
        <ul class="plain">
          <li>Server-rendered shell with partial fetch navigation</li>
          <li>Deep-link trigger for wallet handoff (desktop/mobile)</li>
          <li>SEO-friendly HTML first, JS only for enhancements</li>
        </ul>
      </div>
      <div>
        <p class="eyebrow">Next</p>
        <h3>Roadmap targets</h3>
        <ul class="plain">
          <li>Plug real OIDC4VP verifier and QR generation</li>
          <li>ActivityPub actors for each verified hash</li>
          <li>Gossip protocol to sync uniqueness ledger</li>
        </ul>
      </div>
    </section>
  `;
}

function renderAuthPage({ sessionId, deepLink }) {
  return `
    <section class="panel">
      <p class="eyebrow">Verifier</p>
      <h2>EUDI Wallet handshake</h2>
      <p>This demo issues a credential offer with a blinded session token. Use the link to simulate a wallet responding with a PID hash.</p>
      <div class="callout">
        <p class="muted">Session ID</p>
        <code>${sessionId}</code>
      </div>
      <div class="cta-row">
        <a class="cta" href="${deepLink}" data-deep-link="${deepLink}">Open wallet</a>
        <a class="ghost" href="/auth/callback?session=${sessionId}&pidHash=demo-${sessionId.slice(
          0,
          6,
        )}" data-partial>Simulate callback</a>
      </div>
      <p class="muted small">If your browser blocks the deep link, copy and paste it: <span data-deep-link-fallback></span></p>
    </section>
  `;
}

function renderVerificationComplete({ pidHash }) {
  const short = pidHash.slice(0, 8);
  return `
    <section class="panel">
      <p class="eyebrow">Verification complete</p>
      <h2>Citizen session established</h2>
      <p>The blinded PID hash is now recorded in the Uniqueness Ledger and ready for federation.</p>
      <div class="callout">
        <p class="muted">PID hash (truncated)</p>
        <code>${short}…</code>
      </div>
      <div class="cta-row">
        <a class="cta" href="/" data-partial>Return home</a>
      </div>
    </section>
  `;
}

function renderErrorPage(message) {
  return `
    <section class="panel">
      <p class="eyebrow">Flow error</p>
      <h2>We could not verify your wallet</h2>
      <p class="muted">${message}</p>
      <div class="cta-row">
        <a class="cta" href="/" data-partial>Start over</a>
      </div>
    </section>
  `;
}
