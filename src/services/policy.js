import { POLICIES } from '../config.js';

export function getCirclePolicyState(state) {
  return {
    id: POLICIES.id,
    version: POLICIES.version,
    enforcement: POLICIES.enforceCircle ? 'strict' : 'observing',
    requireVerification: POLICIES.requireVerification,
    peersKnown: state.peers.size,
    ledgerEntries: state.uniquenessLedger.size,
  };
}

export function evaluateDiscussionPermission(citizen) {
  if (POLICIES.requireVerification && !citizen) {
    return {
      allowed: false,
      reason: 'verification_required',
      message: 'Wallet verification required to post in this Circle.',
    };
  }
  return { allowed: true, reason: 'ok' };
}
