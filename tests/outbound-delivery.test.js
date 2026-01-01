import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliverOutbound } from '../src/modules/messaging/outbound.js';

function buildState() {
  return {
    issuer: 'local',
    transactions: [],
    settings: { circleName: 'Test Circle' },
    dataConfig: { mode: 'centralized', adapter: 'memory', validationLevel: 'strict', allowPreviews: false },
    store: { saveTransactions: async () => {} },
  };
}

test('outbound deliveries log suppressed notifications', async () => {
  const state = buildState();
  const result = await deliverOutbound(state, {
    contact: { notify: false, sessionId: 's1', handle: 'h1' },
    notification: { type: 'petition_comment', recipientHash: 'hash-1', message: 'Hello' },
    transport: {
      sendEmail: async () => {
        throw new Error('email should not be called');
      },
      sendSms: async () => {
        throw new Error('sms should not be called');
      },
    },
  });

  assert.equal(result.suppressed, true);
  assert.equal(state.transactions.length, 1);
  const entry = state.transactions[0];
  assert.equal(entry.type, 'outbound_delivery');
  assert.equal(entry.payload.suppressed, true);
  assert.equal(entry.payload.delivered, false);
});

test('outbound deliveries log channel results', async () => {
  const state = buildState();
  const result = await deliverOutbound(state, {
    contact: { email: 'test@example.com', phone: '+12025550123', sessionId: 's2', handle: 'h2' },
    notification: { type: 'petition_comment', recipientHash: 'hash-2', message: 'Hello' },
    transport: {
      sendEmail: async () => true,
      sendSms: async () => true,
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.channels.email, true);
  assert.equal(result.channels.sms, true);
  assert.equal(state.transactions.length, 1);
  const entry = state.transactions[0];
  assert.equal(entry.type, 'outbound_delivery');
  assert.equal(entry.payload.delivered, true);
  assert.equal(entry.payload.channels.email, true);
  assert.equal(entry.payload.channels.sms, true);
});
