import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listModuleDefinitions,
  listModuleFamilyDefinitions,
  normalizeModuleSettings,
  resolveModuleSettings,
} from '../src/modules/circle/modules.js';

test('module defaults enable optional modules', () => {
  const resolved = resolveModuleSettings({ settings: {} });
  assert.equal(resolved.coordination, true);
  assert.equal(resolved.protectedVoice, false);
  assert.equal(resolved.pressureAnalytics, false);
  assert.equal(resolved.petitions, true);
  assert.equal(resolved.votes, true);
  assert.equal(resolved.delegation, true);
  assert.equal(resolved.groups, true);
});

test('module dependencies disable dependent modules', () => {
  const normalized = normalizeModuleSettings({
    coordination: false,
    responsibilities: true,
    pressureAnalytics: true,
    petitions: false,
    votes: true,
    delegation: false,
    groups: true,
  });
  assert.equal(normalized.coordination, false);
  assert.equal(normalized.responsibilities, false);
  assert.equal(normalized.pressureAnalytics, false);
  assert.equal(normalized.petitions, false);
  assert.equal(normalized.votes, false);
  assert.equal(normalized.delegation, false);
  assert.equal(normalized.groups, false);
});

test('module definitions expose organization, social, governance, and federation lanes', () => {
  const families = listModuleFamilyDefinitions();
  assert.ok(families.find((entry) => entry.key === 'organizationOperations'));
  assert.ok(families.find((entry) => entry.key === 'socialP2P'));
  assert.ok(families.find((entry) => entry.key === 'partyGovernance'));
  assert.ok(families.find((entry) => entry.key === 'federationResilience'));

  const byKey = new Map(listModuleDefinitions().map((entry) => [entry.key, entry.family]));
  assert.equal(byKey.get('coordination'), 'organizationOperations');
  assert.equal(byKey.get('mediation'), 'organizationOperations');
  assert.equal(byKey.get('social'), 'socialP2P');
  assert.equal(byKey.get('petitions'), 'partyGovernance');
  assert.equal(byKey.get('federation'), 'federationResilience');
});
