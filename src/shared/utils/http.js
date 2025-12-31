export function sendHtml(res, html, headers = {}, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
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
