import { isIdentityBanned } from './sessions.js';

// Centralize privilege resolution so posting/petition/vote checks share the same rules.
export function getPrivilegesForPerson(person, _state) {
  if (!person) {
    return {
      role: 'guest',
      sessionId: null,
      canPost: false,
      canModerate: false,
      canDelegate: false,
      canPetition: false,
      canVote: false,
      banned: false,
    };
  }

  const role = person.role || 'person';
  const banned = Boolean(person.banned);
  const canModerate = role === 'admin' || role === 'moderator';
  const canVote = !banned && role !== 'guest';
  const canPetition = !banned && role !== 'guest';
  const canPost = !banned && role !== 'guest';

  return {
    role,
    sessionId: person.sessionId || null,
    banned,
    canPost,
    canModerate,
    canDelegate: !banned,
    canPetition,
    canVote,
  };
}

/**
 * First-run window for provider administration.
 *
 * A fresh deployment has nobody who can run the install wizard, so /admin stays
 * open exactly while no admin session exists, and latches shut once one does.
 *
 * The condition is deliberately "an admin exists" rather than "settings are
 * initialized": an operator can finish the wizard without ever creating an admin
 * session, and keying off initialization would lock that deployment out for good.
 * Providers should create an admin session as the last setup step — until they
 * do, the provider is unowned and /admin says so.
 */
export function isAdminBootstrapOpen(state) {
  const sessions = state?.sessions;
  const values = typeof sessions?.values === 'function' ? sessions.values() : [];
  for (const session of values) {
    if (session?.role === 'admin' && !session?.banned && !isIdentityBanned(state, session?.pidHash)) return false;
  }
  return true;
}

/**
 * Provider administration: settings, policy, signing keys, module toggles, and
 * session overrides. Moderators are deliberately excluded — moderation covers
 * content, not the provider's identity and policy configuration.
 */
export function canAdministerProvider(person, state) {
  if (person?.banned) return false;
  if (person?.role === 'admin') return true;
  return isAdminBootstrapOpen(state);
}
