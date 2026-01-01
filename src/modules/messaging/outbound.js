import { normalizeProviderFields } from '../structure/structureManager.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { logTransaction } from '../transactions/registry.js';

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
  if (contact.notify === false) {
    const suppressed = { delivered: false, channels: {}, suppressed: true };
    await logDelivery(state, contact, notification, suppressed);
    return suppressed;
  }
  const circleName = sanitizeText(state?.settings?.circleName || 'Party Circle', 80) || 'Party Circle';
  const typeLabel = sanitizeText(notification?.type || 'Notification', 48) || 'Notification';
  const subject = sanitizeText(`${circleName} · ${typeLabel}`, 120);
  const body = notification.message || '';
  const channels = {};
  if (contact.email && transport.sendEmail) {
    channels.email = await transport.sendEmail({ to: contact.email, subject, body, notification });
  }
  if (contact.phone && transport.sendSms) {
    channels.sms = await transport.sendSms({ to: contact.phone, body, notification });
  }
  const result = { delivered: Boolean(channels.email || channels.sms), channels };
  await logDelivery(state, contact, notification, result);
  return result;
}

export function resolveNotificationPreferences(state, { sessionId, handle } = {}) {
  const attrs = findProviderAttributes(state, sessionId, handle);
  const provider = attrs?.provider || {};
  const globalNotify = readBooleanPreference(provider.notify, true);
  const proposalPreference = readFirstMatchingPreference(provider, [
    'notifyProposalComments',
    'notify_proposal_comments',
    'proposalComments',
    'proposal_comments',
    'notifyPetitionComments',
  ]);
  return {
    proposalComments: proposalPreference ?? globalNotify,
  };
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

function readBooleanPreference(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function readFirstMatchingPreference(provider, keys = []) {
  for (const key of keys) {
    if (provider[key] !== undefined) {
      return readBooleanPreference(provider[key], null);
    }
  }
  return null;
}

async function logDelivery(state, contact, notification, result) {
  if (!state) return;
  try {
    await logTransaction(state, {
      type: 'outbound_delivery',
      actorHash: notification?.recipientHash || null,
      payload: {
        notificationType: notification?.type || null,
        recipientHash: notification?.recipientHash || null,
        sessionId: contact?.sessionId || null,
        handle: contact?.handle || null,
        channels: {
          email: Boolean(contact?.email),
          sms: Boolean(contact?.phone),
        },
        results: result?.channels || {},
        suppressed: Boolean(result?.suppressed),
        delivered: Boolean(result?.delivered),
      },
    });
  } catch (error) {
    console.warn('[outbound] failed to log delivery', error);
  }
}
