export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, text };
}

export async function postForm(url, data = {}, { cookie, headers = {}, partial = false } = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    body.append(key, value);
  }
  const finalHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...headers,
  };
  if (partial) {
    finalHeaders['X-Requested-With'] = 'partial';
  }
  if (cookie) {
    finalHeaders.Cookie = cookie;
  }
  return fetch(url, { method: 'POST', headers: finalHeaders, body });
}

export async function postJson(url, data = {}, { cookie, headers = {} } = {}) {
  const finalHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (cookie) {
    finalHeaders.Cookie = cookie;
  }
  return fetch(url, { method: 'POST', headers: finalHeaders, body: JSON.stringify(data) });
}
