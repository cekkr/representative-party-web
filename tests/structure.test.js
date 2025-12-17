import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProfileSchema,
  CANONICAL_PROFILE_FIELDS,
  parseAttributePayload,
  parseProviderFieldInput,
  upsertProviderAttributes,
} from '../src/modules/structure/structureManager.js';

test('structure manager normalizes provider fields and attributes', () => {
  const providerFields = parseProviderFieldInput('email:email:Contact email\nnotify:boolean:Notify me');

  assert.equal(providerFields.length, 2);
  assert.equal(providerFields[0].key, 'email');
  assert.equal(providerFields[0].type, 'email');
  assert.equal(providerFields[1].key, 'notify');
  assert.equal(providerFields[1].type, 'boolean');

  const schema = buildProfileSchema(providerFields);
  assert.ok(schema.length >= CANONICAL_PROFILE_FIELDS.length + providerFields.length);

  const attributes = parseAttributePayload('email: user@example.org\nnotify: true\nignored: nope', providerFields);
  assert.deepEqual(attributes, { email: 'user@example.org', notify: true });

  const state = { profileAttributes: [] };
  const entry = upsertProviderAttributes(state, { sessionId: 'sess-1', handle: 'citizen-1', attributes });
  assert.equal(state.profileAttributes.length, 1);
  assert.equal(entry.sessionId, 'sess-1');
  assert.equal(entry.provider.email, 'user@example.org');
  assert.equal(entry.provider.notify, true);
});
