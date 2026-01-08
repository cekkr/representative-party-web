import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { URLSearchParams } from 'node:url';

import { PATHS, PORT } from '../../config.js';

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

export async function readMultipartForm(req, { maxBytes = 10 * 1024 * 1024, streamFiles = false, tempDir } = {}) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return { fields: {}, files: [] };
  const boundary = match[1] || match[2];
  if (streamFiles) {
    return readMultipartStream(req, boundary, { maxBytes, tempDir });
  }

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

async function readMultipartStream(req, boundary, { maxBytes, tempDir } = {}) {
  const fields = {};
  const files = [];
  const tempFiles = new Set();
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const boundaryPrefix = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  const uploadRoot = tempDir || join(PATHS.DATA_ROOT, 'uploads');

  await mkdir(uploadRoot, { recursive: true });

  let buffer = Buffer.alloc(0);
  let total = 0;
  let state = 'preamble';
  let current = null;

  const writePartData = async (data) => {
    if (!data || data.length === 0 || !current) return;
    if (current.skip) return;
    if (current.isFile) {
      current.size += data.length;
      await writeStreamChunk(current.stream, data);
      return;
    }
    current.chunks.push(data);
  };

  const finalizePart = async () => {
    if (!current) return;
    if (current.skip) {
      current = null;
      return;
    }
    if (current.isFile) {
      await finalizeWriteStream(current.stream);
      files.push({
        fieldName: current.fieldName,
        filename: current.filename,
        contentType: current.contentType,
        tempPath: current.tempPath,
        size: current.size,
      });
    } else if (current.fieldName) {
      const value = Buffer.concat(current.chunks).toString('utf-8');
      fields[current.fieldName] = value;
    }
    current = null;
  };

  const processBuffer = async (isFinal) => {
    while (true) {
      if (state === 'preamble') {
        const index = buffer.indexOf(boundaryMarker);
        if (index === -1) {
          if (buffer.length > boundaryMarker.length) {
            buffer = buffer.slice(buffer.length - boundaryMarker.length);
          }
          return;
        }
        buffer = buffer.slice(index + boundaryMarker.length);
        if (buffer[0] === 45 && buffer[1] === 45) {
          state = 'done';
          buffer = Buffer.alloc(0);
          return;
        }
        if (buffer[0] === 13 && buffer[1] === 10) {
          buffer = buffer.slice(2);
        }
        state = 'headers';
      }

      if (state === 'headers') {
        const headerEnd = buffer.indexOf(headerSeparator);
        if (headerEnd === -1) return;
        const headerText = buffer.slice(0, headerEnd).toString('utf-8');
        const headers = parseHeaders(headerText);
        buffer = buffer.slice(headerEnd + headerSeparator.length);
        const disposition = headers['content-disposition'] || '';
        const nameMatch = disposition.match(/name="([^"]+)"/i);
        const fieldName = nameMatch ? nameMatch[1] : '';
        const filenameMatch = disposition.match(/filename="([^"]*)"/i);
        const filename = filenameMatch ? filenameMatch[1] : '';
        const contentType = headers['content-type'] || 'application/octet-stream';
        if (!fieldName) {
          current = { skip: true, isFile: false };
          state = 'body';
          continue;
        }
        if (filename) {
          const tempPath = join(uploadRoot, `${randomUUID()}.upload`);
          const stream = createWriteStream(tempPath);
          tempFiles.add(tempPath);
          current = {
            skip: false,
            isFile: true,
            fieldName,
            filename,
            contentType,
            tempPath,
            stream,
            size: 0,
          };
        } else {
          current = { skip: false, isFile: false, fieldName, chunks: [] };
        }
        state = 'body';
      }

      if (state === 'body') {
        const boundaryIndex = buffer.indexOf(boundaryPrefix);
        if (boundaryIndex === -1) {
          if (isFinal) {
            await writePartData(buffer);
            buffer = Buffer.alloc(0);
            await finalizePart();
          } else {
            const keep = boundaryPrefix.length + 4;
            if (buffer.length > keep) {
              const slice = buffer.slice(0, buffer.length - keep);
              await writePartData(slice);
              buffer = buffer.slice(buffer.length - keep);
            }
          }
          return;
        }
        const partData = buffer.slice(0, boundaryIndex);
        await writePartData(partData);
        buffer = buffer.slice(boundaryIndex + boundaryPrefix.length);
        await finalizePart();
        if (buffer[0] === 45 && buffer[1] === 45) {
          state = 'done';
          buffer = Buffer.alloc(0);
          return;
        }
        if (buffer[0] === 13 && buffer[1] === 10) {
          buffer = buffer.slice(2);
        }
        state = 'headers';
      }

      if (state === 'done') {
        buffer = Buffer.alloc(0);
        return;
      }
    }
  };

  try {
    for await (const chunk of req) {
      total += chunk.length;
      if (total > maxBytes) {
        const error = new Error('payload_too_large');
        error.code = 'payload_too_large';
        throw error;
      }
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      await processBuffer(false);
    }
    await processBuffer(true);
  } catch (error) {
    if (current?.stream) {
      current.stream.destroy();
    }
    await cleanupTempFiles(tempFiles);
    throw error;
  }

  return { fields, files };
}

async function writeStreamChunk(stream, chunk) {
  if (!stream || !chunk || chunk.length === 0) return;
  await new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function finalizeWriteStream(stream) {
  if (!stream) return;
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}

async function cleanupTempFiles(tempFiles) {
  const tasks = [];
  for (const filePath of tempFiles || []) {
    tasks.push(unlink(filePath).catch(() => null));
  }
  await Promise.all(tasks);
}
