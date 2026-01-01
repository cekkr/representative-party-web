import { URLSearchParams } from 'node:url';

import { PORT } from '../../config.js';

export async function readRequestBody(req) {
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

export async function readMultipartForm(req, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return { fields: {}, files: [] };
  const boundary = match[1] || match[2];

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('payload_too_large');
      error.code = 'payload_too_large';
      throw error;
    }
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  const parts = splitMultipart(buffer, boundary);
  const fields = {};
  const files = [];

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf-8');
    const body = part.slice(headerEnd + 4);
    const headers = parseHeaders(headerText);
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    const filenameMatch = disposition.match(/filename="([^"]*)"/i);
    const filename = filenameMatch ? filenameMatch[1] : '';
    if (filename) {
      files.push({
        fieldName,
        filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        data: body,
        size: body.length,
      });
    } else {
      fields[fieldName] = body.toString('utf-8');
    }
  }

  return { fields, files };
}

export function parseCookies(header) {
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

export function deriveBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function splitMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = buffer.indexOf(delimiter);
  if (index === -1) return parts;
  index += delimiter.length;

  while (index < buffer.length) {
    if (buffer[index] === 45 && buffer[index + 1] === 45) break;
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      index += 2;
    }
    const next = buffer.indexOf(delimiter, index);
    if (next === -1) break;
    const sliceEnd = Math.max(index, next - 2);
    parts.push(buffer.slice(index, sliceEnd));
    index = next + delimiter.length;
  }
  return parts;
}

function parseHeaders(text) {
  const headers = {};
  const lines = text.split('\r\n');
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }
  return headers;
}
