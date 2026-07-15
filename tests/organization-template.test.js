import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANIZATION_LAYER_DEFINITIONS,
  ORGANIZATION_TEMPLATE_CASES,
  renderLayerPanels,
} from '../src/modules/organization/organizationTemplate.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('organization template models protected voice and independently layered pressure handling', () => {
  const layerKeys = ORGANIZATION_LAYER_DEFINITIONS.map((entry) => entry.key);
  assert.deepEqual(layerKeys, [
    'communication',
    'protection',
    'responsibilities',
    'hierarchies',
    'authority',
    'funds',
    'sectors',
    'mediation',
    'pressure',
    'impact',
  ]);
  assert.ok(ORGANIZATION_TEMPLATE_CASES.find((entry) => entry.voiceType === 'Fundamental need'));
  assert.ok(ORGANIZATION_TEMPLATE_CASES.find((entry) => entry.voiceType === 'Constructive concern'));
  assert.ok(ORGANIZATION_TEMPLATE_CASES.find((entry) => entry.voiceType === 'Advice & innovation'));

  const panels = renderLayerPanels(ORGANIZATION_TEMPLATE_CASES[0], {
    coordination: true,
    protectedVoice: false,
    responsibilities: false,
    hierarchies: false,
    authority: false,
    funds: false,
    sectors: false,
    mediation: false,
    pressureAnalytics: false,
    impactTracking: false,
  });
  assert.match(panels, /Email is inherently attributed/);
  assert.match(panels, /Pressure analytics describe systems and aggregates/);
  assert.match(panels, /Template preview/);
});

test('organization coordination route renders the original project reference as a live template', { timeout: 30000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const response = await fetch(`${server.baseUrl}/organization`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Turn incoming pressure into accountable action/);
  assert.match(html, /Fundamental need/);
  assert.match(html, /Organizational mirror/);
  assert.match(html, /pressure-layer-protection/);
  assert.doesNotMatch(html, /PersonalPressure\.md/);
});
