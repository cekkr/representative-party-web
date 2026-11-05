import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, fetchJson, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('handle can be set and is used across directory, delegation, and author lines', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const alice = await createVerifiedSession(server.baseUrl, { pidHash: 'dir-alice' });
  const bob = await createVerifiedSession(server.baseUrl, { pidHash: 'dir-bob' });

  // Both pick human handles.
  await postForm(`${server.baseUrl}/profile`, { intent: 'handle', handle: 'alice_h' }, { cookie: alice.cookie });
  await postForm(`${server.baseUrl}/profile`, { intent: 'handle', handle: 'bob_h' }, { cookie: bob.cookie });

  // Profile reflects the chosen handle.
  const { text: profileText } = await fetchText(`${server.baseUrl}/profile`, {
    headers: { Cookie: alice.cookie },
  });
  assert.match(profileText, /alice_h/);

  // People directory lists both with handles and supports search.
  const { text: dirText } = await fetchText(`${server.baseUrl}/delegates`, { headers: { Cookie: alice.cookie } });
  const directoryList = /<section\b[^>]*data-composer-section="delegate-directory-list"[^>]*>([\s\S]*?)<\/section>/;
  const people = dirText.match(directoryList)?.[1] || '';
  assert.match(people, /@alice_h/);
  assert.match(people, /@bob_h/);
  const { text: searchText } = await fetchText(`${server.baseUrl}/delegates?q=bob`, {
    headers: { Cookie: alice.cookie },
  });
  const results = searchText.match(directoryList)?.[1] || '';
  assert.match(results, /@bob_h/);
  assert.doesNotMatch(results, /@alice_h/);
  const status = searchText.match(/<div class="status-strip">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(status, /@alice_h/);

  // Delegation accepts a handle (picker value) and resolves it to bob's hash.
  const delegateResp = await postForm(
    `${server.baseUrl}/delegation`,
    { intent: 'set', topic: 'energy', delegateHash: 'bob_h' },
    { cookie: alice.cookie },
  );
  assert.ok(delegateResp.status < 400, `delegation set status ${delegateResp.status}`);

  const { text: delegationText } = await fetchText(`${server.baseUrl}/delegation`, {
    headers: { Cookie: alice.cookie },
  });
  // The effective-chain and list now show bob's handle, not the raw hash alone.
  assert.match(delegationText, /@bob_h/);
});

test('handle uniqueness and validation are enforced over HTTP', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const alice = await createVerifiedSession(server.baseUrl, { pidHash: 'uniq-alice' });
  const bob = await createVerifiedSession(server.baseUrl, { pidHash: 'uniq-bob' });

  await postForm(`${server.baseUrl}/profile`, { intent: 'handle', handle: 'shared_h' }, { cookie: alice.cookie });

  // Bob cannot take alice's handle.
  const taken = await postForm(
    `${server.baseUrl}/profile`,
    { intent: 'handle', handle: 'shared_h' },
    { cookie: bob.cookie },
  );
  const takenText = await taken.text();
  assert.match(takenText, /already taken/i);

  // Invalid handle is rejected with a helpful message.
  const invalid = await postForm(
    `${server.baseUrl}/profile`,
    { intent: 'handle', handle: 'no spaces!' },
    { cookie: bob.cookie },
  );
  const invalidText = await invalid.text();
  assert.match(invalidText, /letters, numbers, dashes/i);
});

test('delegation to an unknown person is rejected with guidance', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const alice = await createVerifiedSession(server.baseUrl, { pidHash: 'unk-alice' });
  const resp = await fetchJson(`${server.baseUrl}/delegation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: alice.cookie },
    body: new URLSearchParams({ intent: 'set', topic: 'energy', delegateHash: 'nobody-here' }),
  });
  assert.equal(resp.response.status, 404);
  assert.equal(resp.payload.error, 'unknown_delegate');
});
