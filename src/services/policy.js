import { POLICIES } from '../config.js';
import { getPrivilegesForCitizen } from './privileges.js';

export function getEffectivePolicy(state) {
  const settings = state.settings || {};
  return {
    ...POLICIES,
    id: settings.policyId || POLICIES.id,
    circleName: settings.circleName || 'Party Circle',
    enforceCircle: settings.enforceCircle ?? POLICIES.enforceCircle,
    requireVerification: settings.requireVerification ?? POLICIES.requireVerification,
    adminContact: settings.adminContact || '',
    preferredPeer: settings.preferredPeer || '',
    initialized: Boolean(settings.initialized),
    notes: settings.notes || '',
  };
}

export function getCirclePolicyState(state) {
  const effective = getEffectivePolicy(state);
  return {
    id: effective.id,
    version: effective.version,
    enforcement: effective.enforceCircle ? 'strict' : 'observing',
    requireVerification: effective.requireVerification,
    peersKnown: state.peers.size,
    ledgerEntries: state.uniquenessLedger.size,
    circleName: effective.circleName,
    initialized: effective.initialized,
  };
}

export function evaluateDiscussionPermission(state, citizen) {
  const policy = getEffectivePolicy(state);

  if (!citizen && !policy.requireVerification) {
    return { allowed: true, reason: 'open_circle_guest', role: 'guest' };
  }

  if (policy.requireVerification && !citizen) {
    return {
      allowed: false,
      reason: 'verification_required',
      message: 'Wallet verification required to post in this Circle.',
    };
  }

  const privileges = getPrivilegesForCitizen(citizen, state);
  if (privileges.banned) {
    return {
      allowed: false,
      reason: 'banned',
      message: 'Posting blocked: this handle is banned in the Circle.',
    };
  }

  if (!privileges.canPost) {
    return {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Posting blocked: insufficient privileges for this action.',
    };
  }

  return { allowed: true, reason: 'ok', role: privileges.role };
}
