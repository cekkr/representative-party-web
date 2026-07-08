import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('installation wizard shows on first run and hides after save', async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const { response, text } = await fetchText(`${server.baseUrl}/admin`);
  assert.equal(response.status, 200);
  assert.match(text, /data-install-mode="wizard"/);
  assert.match(text, /data-wizard-step="3"/);

  const saveResponse = await postForm(
    `${server.baseUrl}/admin`,
    { circleName: 'Wizard Circle', policyId: 'wizard-policy' },
    { partial: true },
  );
  assert.equal(saveResponse.status, 200);

  const { text: afterText } = await fetchText(`${server.baseUrl}/admin`);
  assert.match(afterText, /data-install-mode="full"/);
  assert.match(afterText, /Initialized: true/);
});
