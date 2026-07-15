import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  installExtension,
  loadExtensions,
  listAvailableExtensions,
  uninstallExtension,
} from '../src/modules/extensions/registry.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { fetchJson, fetchText, postJson } from './helpers/http.js';

const SAMPLE_ID = 'sample-policy-tighten';

test('loads sample extension when enabled', async () => {
  const { active } = await loadExtensions({ list: [SAMPLE_ID] });
  assert.ok(active.find((ext) => ext.id === SAMPLE_ID));
});

test('catalog reports installed, enabled, active, and version state independently', async () => {
  const state = {
    settings: { extensions: [SAMPLE_ID] },
    extensions: { active: [] },
  };
  state.extensions = await loadExtensions({ list: state.settings.extensions });
  const available = await listAvailableExtensions(state);
  const sample = available.find((entry) => entry.id === SAMPLE_ID);

  assert.ok(sample);
  assert.equal(sample.version, '1.0.0');
  assert.equal(sample.installedVersion, '1.0.0');
  assert.equal(sample.source, 'bundled');
  assert.equal(sample.installed, true, 'legacy enabled extensions remain installed');
  assert.equal(sample.enabled, true);
  assert.equal(sample.active, true);
  assert.equal(sample.updateAvailable, false);
});

test('install and uninstall record lifecycle metadata without deleting catalog entries', async () => {
  const state = { settings: { extensions: [], extensionInstallations: [] }, extensions: { active: [] } };
  const installedAt = '2026-07-15T10:00:00.000Z';

  const installed = await installExtension(state, SAMPLE_ID, { now: installedAt });
  assert.equal(installed.installation.version, '1.0.0');
  assert.equal(installed.installation.installedAt, installedAt);
  assert.equal(state.settings.extensions.length, 0, 'install does not implicitly enable hooks');

  let available = await listAvailableExtensions(state);
  assert.equal(available.find((entry) => entry.id === SAMPLE_ID)?.installed, true);

  state.settings.extensions = [SAMPLE_ID];
  state.extensions = await loadExtensions({
    list: state.settings.extensions,
    installations: state.settings.extensionInstallations,
  });
  assert.equal(state.extensions.active[0]?.id, SAMPLE_ID);

  const result = uninstallExtension(state, SAMPLE_ID);
  assert.equal(result.uninstalled, true);
  assert.deepEqual(state.settings.extensions, []);
  assert.deepEqual(state.settings.extensionInstallations, []);

  available = await listAvailableExtensions(state);
  const sample = available.find((entry) => entry.id === SAMPLE_ID);
  assert.ok(sample, 'source remains discoverable after uninstall');
  assert.equal(sample.installed, false);
});

test('catalog flags version drift and reinstall updates the version without resetting install time', async () => {
  const installedAt = '2026-07-01T08:00:00.000Z';
  const state = {
    settings: {
      extensions: [],
      extensionInstallations: [
        {
          id: SAMPLE_ID,
          file: `${SAMPLE_ID}.js`,
          version: '0.9.0',
          source: 'bundled',
          installedAt,
          updatedAt: installedAt,
        },
      ],
    },
    extensions: { active: [] },
  };

  const before = (await listAvailableExtensions(state)).find((entry) => entry.id === SAMPLE_ID);
  assert.equal(before.updateAvailable, true);
  assert.equal(before.installedVersion, '0.9.0');

  const updated = await installExtension(state, SAMPLE_ID, { now: '2026-07-15T10:00:00.000Z' });
  assert.equal(updated.updated, true);
  assert.equal(updated.installation.version, '1.0.0');
  assert.equal(updated.installation.installedAt, installedAt);
});

test('extension endpoint requires install before enable and applies lifecycle immediately', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(() => server.stop());

  const blocked = await postJson(`${server.baseUrl}/extensions`, { extensions: [`${SAMPLE_ID}.js`] });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, 'extensions_not_installed');

  const installed = await postJson(`${server.baseUrl}/extensions`, { intent: 'install', id: SAMPLE_ID });
  assert.equal(installed.status, 200);
  const installedPayload = await installed.json();
  assert.equal(installedPayload.result.installation.version, '1.0.0');
  assert.deepEqual(installedPayload.active, []);

  const { text: adminHtml } = await fetchText(`${server.baseUrl}/admin`);
  assert.match(adminHtml, /Extension lifecycle/);
  assert.match(adminHtml, /sample-policy-tighten/);
  assert.match(adminHtml, /v1\.0\.0/);
  assert.match(adminHtml, /Installed/);

  const enabled = await postJson(`${server.baseUrl}/extensions`, { extensions: [SAMPLE_ID] });
  assert.equal(enabled.status, 200);
  assert.deepEqual((await enabled.json()).active, [SAMPLE_ID]);

  const { payload: catalog } = await fetchJson(`${server.baseUrl}/extensions`);
  const sample = catalog.available.find((entry) => entry.id === SAMPLE_ID);
  assert.equal(sample.installed, true);
  assert.equal(sample.enabled, true);
  assert.equal(sample.active, true);

  const uninstalled = await postJson(`${server.baseUrl}/extensions`, { lifecycle: `uninstall:${SAMPLE_ID}` });
  assert.equal(uninstalled.status, 200);
  const uninstallPayload = await uninstalled.json();
  assert.deepEqual(uninstallPayload.enabled, []);
  assert.deepEqual(uninstallPayload.active, []);
  assert.equal(uninstallPayload.available.find((entry) => entry.id === SAMPLE_ID)?.installed, false);
});

test('extension lifecycle rejects path-like ids', async () => {
  const state = { settings: { extensions: [], extensionInstallations: [] } };
  await assert.rejects(
    () => installExtension(state, '../sample-policy-tighten'),
    (error) => error?.code === 'invalid_extension_id',
  );
});
