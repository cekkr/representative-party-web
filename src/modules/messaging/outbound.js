import { normalizeProviderFields } from '../structure/structureManager.js';

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
