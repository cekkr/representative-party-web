import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchText, postForm, postJson } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { buildActivityPubCreateNote } from './helpers/activitypub.js';

test('ActivityPub inbox stores preview notes when previews allowed', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory', allowPreviews: true });
  t.after(async () => server.stop());

  const content = 'Inbound note preview content';
  const payload = buildActivityPubCreateNote({
    content,
    activityId: 'https://remote.example/ap/activities/inbox-1',
    objectId: 'https://remote.example/ap/objects/inbox-1',
  });
  const response = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'accepted');
  assert.equal(body.validationStatus, 'preview');

  const duplicate = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicate.status, 202);
  assert.equal(duplicateBody.status, 'duplicate');

  const { text } = await fetchText(`${server.baseUrl}/social/feed`);
  assert.ok(text.includes(content));
});

test('ActivityPub inbox blocks previews when preview storage is disabled', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory', allowPreviews: false });
  t.after(async () => server.stop());

  const content = 'Inbound note should be blocked';
  const payload = buildActivityPubCreateNote({
    content,
    activityId: 'https://remote.example/ap/activities/inbox-2',
    objectId: 'https://remote.example/ap/objects/inbox-2',
  });
  const response = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.error, 'preview_blocked');

  const { text } = await fetchText(`${server.baseUrl}/social/feed`);
  assert.ok(!text.includes(content));
});

test('ActivityPub inbox rejects policy mismatches', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory', allowPreviews: true });
  t.after(async () => server.stop());

  const payload = buildActivityPubCreateNote({
    content: 'Policy mismatch note',
    activityId: 'https://remote.example/ap/activities/inbox-3',
    objectId: 'https://remote.example/ap/objects/inbox-3',
    policy: { id: 'wrong-policy', version: 99 },
  });
  const response = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error, 'policy_mismatch');
});

test('ActivityPub inbox respects social module toggles', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory', allowPreviews: true });
  t.after(async () => server.stop());

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'modules', module_federation: 'on' },
    { partial: true },
  );

  const payload = buildActivityPubCreateNote({
    content: 'Social module disabled note',
    activityId: 'https://remote.example/ap/activities/inbox-4',
    objectId: 'https://remote.example/ap/objects/inbox-4',
  });
  const response = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error, 'module_disabled');
  assert.equal(body.module, 'social');
});
