import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { URLSearchParams } from 'node:url';

import { PATHS, PORT } from '../../config.js';

const DEFAULT_FIELD_MAX_BYTES = 64 * 1024;
const DEFAULT_FIELD_TOTAL_MAX_BYTES = 128 * 1024;
const DEFAULT_FIELD_MAX_COUNT = 40;
const DEFAULT_FIELD_NAME_MAX_BYTES = 128;
const DEFAULT_HEADER_MAX_BYTES = 8 * 1024;

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

export async function readMultipartForm(
  req,
  {
    maxBytes = 10 * 1024 * 1024,
    maxFieldBytes = DEFAULT_FIELD_MAX_BYTES,
    maxFieldBytesTotal = DEFAULT_FIELD_TOTAL_MAX_BYTES,
    maxFieldCount = DEFAULT_FIELD_MAX_COUNT,
    maxFieldNameBytes = DEFAULT_FIELD_NAME_MAX_BYTES,
    maxHeaderBytes = DEFAULT_HEADER_MAX_BYTES,
    streamFiles = false,
    tempDir,
  } = {},
) {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return { fields: {}, files: [] };
  const boundary = match[1] || match[2];
  if (streamFiles) {
    return readMultipartStream(req, boundary, {
      maxBytes,
      maxFieldBytes,
      maxFieldBytesTotal,
      maxFieldCount,
      maxFieldNameBytes,
      maxHeaderBytes,
      tempDir,
    });
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
  let fieldBytesTotal = 0;
  let fieldCount = 0;

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    if (isHeaderLimitExceeded(maxHeaderBytes, headerEnd)) {
      throw createHeadersTooLargeError(maxHeaderBytes);
    }
    const headerText = part.slice(0, headerEnd).toString('utf-8');
    const body = part.slice(headerEnd + 4);
    const headers = parseHeaders(headerText);
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;
    const fieldName = nameMatch[1];
    if (isFieldNameLimitExceeded(maxFieldNameBytes, fieldName)) {
      throw createFieldNameTooLargeError(maxFieldNameBytes);
    }
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
      fieldCount += 1;
      if (isFieldCountExceeded(maxFieldCount, fieldCount)) {
        throw createFieldCountTooLargeError(maxFieldCount);
      }
      if (isFieldLimitExceeded(maxFieldBytes, body.length)) {
        throw createFieldTooLargeError(fieldName, maxFieldBytes);
      }
      fieldBytesTotal += body.length;
      if (isFieldTotalLimitExceeded(maxFieldBytesTotal, fieldBytesTotal)) {
        throw createFieldTotalTooLargeError(maxFieldBytesTotal);
      }
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

export async function cleanupTempUploads({ maxAgeMs = 24 * 60 * 60 * 1000, tempDir } = {}) {
  const uploadRoot = tempDir || PATHS.UPLOADS_ROOT;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return { scanned: 0, cleaned: 0, skipped: 0 };
  }
  let entries;
  try {
    entries = await readdir(uploadRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { scanned: 0, cleaned: 0, skipped: 0 };
    }
    throw error;
  }
  const now = Date.now();
  let cleaned = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.upload')) continue;
    const filePath = join(uploadRoot, entry.name);
    let info;
    try {
      info = await stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (now - info.mtimeMs > maxAgeMs) {
      await unlink(filePath).catch(() => null);
      cleaned += 1;
    } else {
      skipped += 1;
    }
  }
  return { scanned: entries.length, cleaned, skipped };
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

async function readMultipartStream(
  req,
  boundary,
  { maxBytes, maxFieldBytes, maxFieldBytesTotal, maxFieldCount, maxFieldNameBytes, maxHeaderBytes, tempDir } = {},
) {
  const fields = {};
  const files = [];
  const tempFiles = new Set();
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const boundaryPrefix = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from('\r\n\r\n');
  const uploadRoot = tempDir || PATHS.UPLOADS_ROOT;

  await mkdir(uploadRoot, { recursive: true });

  let buffer = Buffer.alloc(0);
  let total = 0;
  let state = 'preamble';
  let current = null;
  let fieldBytesTotal = 0;
  let fieldCount = 0;

  const writePartData = async (data) => {
    if (!data || data.length === 0 || !current) return;
    if (current.skip) return;
    if (current.isFile) {
      current.size += data.length;
      await writeStreamChunk(current.stream, data);
      return;
    }
    const nextSize = current.size + data.length;
    if (isFieldLimitExceeded(maxFieldBytes, nextSize)) {
      throw createFieldTooLargeError(current.fieldName, maxFieldBytes);
    }
    const nextTotal = fieldBytesTotal + data.length;
    if (isFieldTotalLimitExceeded(maxFieldBytesTotal, nextTotal)) {
      throw createFieldTotalTooLargeError(maxFieldBytesTotal);
    }
    current.size = nextSize;
    fieldBytesTotal = nextTotal;
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
        if (isHeaderLimitExceeded(maxHeaderBytes, headerEnd)) {
          throw createHeadersTooLargeError(maxHeaderBytes);
        }
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
        if (isFieldNameLimitExceeded(maxFieldNameBytes, fieldName)) {
          throw createFieldNameTooLargeError(maxFieldNameBytes);
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
          fieldCount += 1;
          if (isFieldCountExceeded(maxFieldCount, fieldCount)) {
            throw createFieldCountTooLargeError(maxFieldCount);
          }
          current = { skip: false, isFile: false, fieldName, chunks: [], size: 0 };
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

function isFieldLimitExceeded(maxFieldBytes, size) {
  if (!Number.isFinite(maxFieldBytes) || maxFieldBytes <= 0) return false;
  return size > maxFieldBytes;
}

function isFieldNameLimitExceeded(maxFieldNameBytes, value = '') {
  if (!Number.isFinite(maxFieldNameBytes) || maxFieldNameBytes <= 0) return false;
  return Buffer.byteLength(String(value), 'utf-8') > maxFieldNameBytes;
}

function isHeaderLimitExceeded(maxHeaderBytes, size) {
  if (!Number.isFinite(maxHeaderBytes) || maxHeaderBytes <= 0) return false;
  return size > maxHeaderBytes;
}

function isFieldTotalLimitExceeded(maxFieldBytesTotal, size) {
  if (!Number.isFinite(maxFieldBytesTotal) || maxFieldBytesTotal <= 0) return false;
  return size > maxFieldBytesTotal;
}

function isFieldCountExceeded(maxFieldCount, count) {
  if (!Number.isFinite(maxFieldCount) || maxFieldCount <= 0) return false;
  return count > maxFieldCount;
}

function createFieldTooLargeError(fieldName, maxFieldBytes) {
  const error = new Error('field_too_large');
  error.code = 'field_too_large';
  error.fieldName = fieldName;
  error.maxFieldBytes = maxFieldBytes;
  return error;
}

function createFieldNameTooLargeError(maxFieldNameBytes) {
  const error = new Error('field_name_too_large');
  error.code = 'field_name_too_large';
  error.maxFieldNameBytes = maxFieldNameBytes;
  return error;
}

function createFieldTotalTooLargeError(maxFieldBytesTotal) {
  const error = new Error('fields_too_large');
  error.code = 'fields_too_large';
  error.maxFieldBytesTotal = maxFieldBytesTotal;
  return error;
}

function createFieldCountTooLargeError(maxFieldCount) {
  const error = new Error('too_many_fields');
  error.code = 'too_many_fields';
  error.maxFieldCount = maxFieldCount;
  return error;
}

function createHeadersTooLargeError(maxHeaderBytes) {
  const error = new Error('headers_too_large');
  error.code = 'headers_too_large';
  error.maxHeaderBytes = maxHeaderBytes;
  return error;
}
