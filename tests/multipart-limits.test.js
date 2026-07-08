import assert from 'node:assert/strict';
import { mkdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

import { PATHS } from '../src/config.js';
import { createVerifiedSession } from './helpers/auth.js';
import { getAvailablePort, startServer } from './helpers/server.js';

function buildMultipart(fields = []) {
  const boundary = `----rpw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const { name, value } of fields) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    chunks.push(`${value}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.from(chunks.join(''), 'utf-8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function buildMultipartWithFile({
  fields = [],
  fileField = 'media',
  filename = 'upload.txt',
  contentType = 'text/plain',
  data = 'file',
} = {}) {
  const boundary = `----rpw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const { name, value } of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\n`));
  chunks.push(
    Buffer.from(
      `Content-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
  );
  chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8'));
  chunks.push(Buffer.from('\r\n'));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function waitForRemoval(filePath, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
    await delay(100);
  }
  return false;
}

test('social multipart rejects total field bytes over limit', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_FIELD_TOTAL_MAX_BYTES: '32',
      SOCIAL_MEDIA_FIELD_MAX_BYTES: '64',
      SOCIAL_MEDIA_FIELD_MAX_COUNT: '10',
    },
  });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'multipart-total' });
  const { body, contentType } = buildMultipart([
    { name: 'content', value: 'a'.repeat(20) },
    { name: 'targetHandle', value: 'b'.repeat(20) },
  ]);

  const response = await fetch(`${server.baseUrl}/social/post`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Cookie: session.cookie },
    body,
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assert.equal(payload.error, 'fields_too_large');
});

test('social multipart rejects too many fields', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_FIELD_TOTAL_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_COUNT: '1',
    },
  });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'multipart-count' });
  const { body, contentType } = buildMultipart([
    { name: 'content', value: 'hello' },
    { name: 'targetHandle', value: 'someone' },
  ]);

  const response = await fetch(`${server.baseUrl}/social/post`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Cookie: session.cookie },
    body,
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assert.equal(payload.error, 'too_many_fields');
});

test('social multipart rejects filename over limit', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_FILENAME_MAX_BYTES: '8',
      SOCIAL_MEDIA_FIELD_TOTAL_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_COUNT: '10',
    },
  });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'multipart-filename' });
  const { body, contentType } = buildMultipartWithFile({
    fields: [{ name: 'content', value: 'hello' }],
    filename: 'toolongname.png',
    contentType: 'image/png',
    data: 'tiny',
  });

  const response = await fetch(`${server.baseUrl}/social/post`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Cookie: session.cookie },
    body,
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assert.equal(payload.error, 'filename_too_large');
});

test('social multipart rejects field names over limit', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_FIELD_NAME_MAX_BYTES: '8',
      SOCIAL_MEDIA_FIELD_TOTAL_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_COUNT: '10',
    },
  });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'multipart-field-name' });
  const { body, contentType } = buildMultipart([{ name: 'content-field-too-long', value: 'hello' }]);

  const response = await fetch(`${server.baseUrl}/social/post`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Cookie: session.cookie },
    body,
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assert.equal(payload.error, 'field_name_too_large');
});

test('social multipart rejects oversized part headers', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_HEADER_MAX_BYTES: '24',
      SOCIAL_MEDIA_FIELD_TOTAL_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_BYTES: '1024',
      SOCIAL_MEDIA_FIELD_MAX_COUNT: '10',
    },
  });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'multipart-header-size' });
  const { body, contentType } = buildMultipart([{ name: 'content', value: 'hello' }]);

  const response = await fetch(`${server.baseUrl}/social/post`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, Cookie: session.cookie },
    body,
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assert.equal(payload.error, 'headers_too_large');
});

test('periodic upload cleanup removes stale temp files', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: {
      SOCIAL_MEDIA_UPLOAD_RETENTION_HOURS: '0.0001',
      SOCIAL_MEDIA_UPLOAD_CLEANUP_MINUTES: '0.001',
    },
  });
  t.after(async () => server.stop());

  await mkdir(PATHS.UPLOADS_ROOT, { recursive: true });
  const filename = `cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}.upload`;
  const filePath = path.join(PATHS.UPLOADS_ROOT, filename);
  await writeFile(filePath, 'stale');
  const past = Date.now() - 10_000;
  await utimes(filePath, past / 1000, past / 1000);
  t.after(async () => {
    await unlink(filePath).catch(() => null);
  });

  const removed = await waitForRemoval(filePath, 2500);
  assert.equal(removed, true);
});
