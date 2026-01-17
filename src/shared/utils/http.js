import { gzipSync } from 'node:zlib';

export function sendHtml(res, html, headers = {}, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

export function sendJsonWithEncoding(req, res, status, payload, { allowGzip = false } = {}) {
  const json = JSON.stringify(payload, null, 2);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
  if (allowGzip && clientAcceptsGzip(req)) {
    const compressed = gzipSync(json);
    res.writeHead(status, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': Buffer.byteLength(compressed),
    });
    res.end(compressed);
    return;
  }
  res.writeHead(status, headers);
  res.end(json);
}

export function sendRateLimit(res, payload = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (payload.retryAfter) {
    headers['Retry-After'] = String(payload.retryAfter);
  }
  res.writeHead(429, headers);
  res.end(JSON.stringify({ error: 'rate_limited', ...payload }, null, 2));
}

export function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
}

export function sendRedirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function clientAcceptsGzip(req) {
  const header = String(req?.headers?.['accept-encoding'] || '');
  if (!header) return false;
  const parts = header.split(',');
  for (const part of parts) {
    const [encoding, ...params] = part.trim().toLowerCase().split(';');
    if (encoding !== 'gzip') continue;
    const qParam = params.find((param) => param.trim().startsWith('q='));
    if (!qParam) return true;
    const value = Number(qParam.trim().split('=')[1]);
    return Number.isFinite(value) ? value > 0 : true;
  }
  return false;
}
