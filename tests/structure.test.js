import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProfileSchema,
  CANONICAL_PROFILE_FIELDS,
  parseAttributePayloadWithValidation,
  parseProviderFieldInput,
  upsertProviderAttributes,
} from '../src/modules/structure/structureManager.js';
import { resolveContactChannels, deliverOutbound } from '../src/modules/messaging/outbound.js';

test('structure manager normalizes provider fields and attributes', () => {
  const { fields, errors } = parseProviderFieldInput('email:email:Contact email\nphone:phone:Mobile\nnotify:boolean:Notify me');
  assert.equal(errors.length, 0);

  assert.equal(fields.length, 3);
  assert.equal(fields[0].key, 'email');
  assert.equal(fields[0].type, 'email');
  assert.equal(fields[1].key, 'phone');
  assert.equal(fields[1].type, 'phone');
  assert.equal(fields[2].key, 'notify');
  assert.equal(fields[2].type, 'boolean');

  const schema = buildProfileSchema(fields);
  assert.ok(schema.length >= CANONICAL_PROFILE_FIELDS.length + fields.length);

  const { attributes, errors: attrErrors } = parseAttributePayloadWithValidation(
    'email: user@example.org\nphone: +15551234567\nnotify: true\nignored: nope',
    fields,
  );
  assert.equal(attrErrors.length, 0);
  assert.deepEqual(attributes, { email: 'user@example.org', phone: '+15551234567', notify: true });

  const state = { profileAttributes: [] };
  const entry = upsertProviderAttributes(state, { sessionId: 'sess-1', handle: 'citizen-1', attributes });
  assert.equal(state.profileAttributes.length, 1);
  assert.equal(entry.sessionId, 'sess-1');
  assert.equal(entry.provider.email, 'user@example.org');
  assert.equal(entry.provider.notify, true);

  const { attributes: invalidAttrs, errors: invalidErrors } = parseAttributePayloadWithValidation('email: not-an-email', fields);
  assert.equal(invalidErrors.length, 1);
  assert.deepEqual(invalidAttrs, {});

  const contact = resolveContactChannels(
    { profileStructures: fields, profileAttributes: [entry] },
    { sessionId: 'sess-1', handle: 'citizen-1' },
  );
  assert.equal(contact.email, 'user@example.org');
  assert.equal(contact.handle, 'citizen-1');
  assert.equal(contact.providerOnly, true);

  let lastEmail = null;
  let lastSms = null;
  const outbound = await deliverOutbound(
    { settings: { circleName: 'Demo Circle' } },
    {
      contact,
      notification: { message: 'Hello world', type: 'social_mention' },
      transport: {
        sendEmail: async (payload) => {
          lastEmail = payload;
          return true;
        },
        sendSms: async (payload) => {
          lastSms = payload;
          return true;
        },
      },
    },
  );
  assert.equal(outbound.delivered, true);
  assert.equal(outbound.channels.email, true);
  assert.equal(outbound.channels.sms, true);
  assert.equal(lastEmail.subject, 'Demo Circle · social_mention');
  assert.equal(lastSms.to, contact.phone || null);
});
