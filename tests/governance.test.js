import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getGovernanceSettings, normalizeGovernanceSettings } from '../src/modules/governance/constitution.js';

test('normalizeGovernanceSettings clamps ranges and defaults the vote method', () => {
  const normalized = normalizeGovernanceSettings({
    quorumDefault: -5,
    discussionWindowDays: 500,
    voteWindowDays: 'bad',
    reviewWindowHours: 999,
    defaultVoteMethod: 'unknown',
    notes: '  Keep it short  ',
  });

  assert.equal(normalized.quorumDefault, 0);
  assert.equal(normalized.discussionWindowDays, 365);
  assert.equal(normalized.voteWindowDays, 7);
  assert.equal(normalized.reviewWindowHours, 168);
  assert.equal(normalized.defaultVoteMethod, 'majority');
  assert.equal(normalized.notes, 'Keep it short');
});

test('getGovernanceSettings falls back to defaults when settings are missing', () => {
  const settings = getGovernanceSettings({});
  assert.equal(settings.quorumDefault, 20);
  assert.equal(settings.discussionWindowDays, 14);
  assert.equal(settings.voteWindowDays, 7);
  assert.equal(settings.reviewWindowHours, 24);
  assert.equal(settings.defaultVoteMethod, 'majority');
});
