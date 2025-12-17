import { normalizeProviderFields } from '../structure/structureManager.js';
import { sanitizeText } from '../../shared/utils/text.js';

const defaultTransport = {
  async sendEmail({ to, subject, body }) {
    console.info(`[outbound email stub] to=${to} subject=${subject} body=${body.slice(0, 160)}`);
    return true;
  },
  async sendSms({ to, body }) {
    console.info(`[outbound sms stub] to=${to} body=${body.slice(0, 160)}`);
    return true;
  },
};

/**
 * Resolve provider-local contact channels (email/phone/notify flag) for a session/handle.
 * Data stays local (profileAttributes are not gossiped); callers must own actual delivery.
 */
export function resolveContactChannels(state, { sessionId, handle } = {}) {
  const attrs = findProviderAttributes(state, sessionId, handle);
  const schema = normalizeProviderFields(state.profileStructures || []);
  const contact = {
    email: null,
    phone: null,
    notify: null,
    attributes: attrs?.provider || {},
    handle: attrs?.handle || handle || '',
    sessionId: attrs?.sessionId || sessionId || '',
    providerOnly: true,
  };
  if (!attrs || !attrs.provider) return contact;

  for (const field of schema) {
    if (field.scope !== 'provider') continue;
    const value = attrs.provider[field.key];
    if (value === undefined || value === null) continue;
    if (field.type === 'email') contact.email = String(value);
    if (field.type === 'phone') contact.phone = String(value);
    if (field.type === 'boolean' && field.key === 'notify') contact.notify = Boolean(value);
  }
  return contact;
}

export async function deliverOutbound(state, { contact, notification, transport = defaultTransport }) {
  if (!contact) return { delivered: false, channels: {} };
  const subject = sanitizeText(notification.message || 'Notification', 120);
  const body = notification.message || '';
  const channels = {};
  if (contact.email && transport.sendEmail) {
    channels.email = await transport.sendEmail({ to: contact.email, subject, body, notification });
  }
  if (contact.phone && transport.sendSms) {
    channels.sms = await transport.sendSms({ to: contact.phone, body, notification });
  }
  return { delivered: Boolean(channels.email || channels.sms), channels };
}

function findProviderAttributes(state, sessionId, handle) {
  const list = state.profileAttributes || [];
  if (sessionId) {
    const match = list.find((entry) => entry.sessionId === sessionId);
    if (match) return match;
  }
  if (handle) {
    const match = list.find((entry) => entry.handle === handle);
    if (match) return match;
  }
  return null;
}
