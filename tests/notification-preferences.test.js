import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveNotificationPreferences } from '../src/modules/messaging/outbound.js';

test('notification preferences default to true', () => {
  const prefs = resolveNotificationPreferences({ profileAttributes: [] }, { sessionId: 'missing' });
  assert.equal(prefs.proposalComments, true);
});

test('notification preferences honor proposal comment toggle', () => {
  const state = {
    profileAttributes: [
      { sessionId: 's1', handle: 'h1', provider: { notifyProposalComments: false } },
    ],
  };
  const prefs = resolveNotificationPreferences(state, { sessionId: 's1' });
  assert.equal(prefs.proposalComments, false);
});

test('notification preferences inherit global notify flag', () => {
  const state = {
    profileAttributes: [
      { sessionId: 's2', handle: 'h2', provider: { notify: false } },
    ],
  };
  const prefs = resolveNotificationPreferences(state, { sessionId: 's2' });
  assert.equal(prefs.proposalComments, false);
});
