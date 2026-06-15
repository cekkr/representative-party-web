import { test } from 'node:test';
import assert from 'node:assert/strict';

import { humanizeNotificationType } from '../src/modules/notifications/http/notifications.js';
import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('humanizeNotificationType maps known types and falls back to Title Case', () => {
  assert.equal(humanizeNotificationType('petition_created'), 'Proposal created');
  assert.equal(humanizeNotificationType('social_mention'), 'You were mentioned');
  assert.equal(humanizeNotificationType('delegation_renew'), 'Delegation renewed');
  // Unknown type: readable Title Case fallback, never the raw snake_case string.
  assert.equal(humanizeNotificationType('some_new_event'), 'Some New Event');
  assert.equal(humanizeNotificationType(''), 'Notification');
});

test('notifications page shows a human label instead of the raw event type', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const alice = await createVerifiedSession(server.baseUrl, { pidHash: 'notif-alice' });
  // Drafting a proposal creates a petition_created notification for the author.
  await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Energy plan', summary: 'Phase out coal', topic: 'energy' },
    { cookie: alice.cookie },
  );

  const { text } = await fetchText(`${server.baseUrl}/notifications`, { headers: { Cookie: alice.cookie } });
  assert.match(text, /Proposal created/);
  // The raw type only survives inside the title attribute, not as visible pill text.
  assert.doesNotMatch(text, />\s*petition_created\s*</);
});
