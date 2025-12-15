import { POLICIES } from '../config.js';
import { getPrivilegesForCitizen } from './privileges.js';

const ROLE_ORDER = ['guest', 'citizen', 'delegate', 'moderator', 'admin'];

const ACTION_RULES = {
  post: { capability: 'canPost', minRole: 'citizen', requireVerification: undefined, allowGuestWhenOpen: true },
  petition: { capability: 'canPetition', minRole: 'citizen', requireVerification: true },
  vote: { capability: 'canVote', minRole: 'citizen', requireVerification: true },
  moderate: { capability: 'canModerate', allowedRoles: ['moderator', 'admin'], requireVerification: true },
};

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

export function evaluateAction(state, citizen, action = 'post') {
  const policy = getEffectivePolicy(state);
  const rule = ACTION_RULES[action] || ACTION_RULES.post;
  const enforcement = policy.enforceCircle ? 'strict' : 'observing';
  const verificationRequired = rule.requireVerification ?? policy.requireVerification;

  if (!citizen && verificationRequired) {
    return {
      allowed: false,
      reason: 'verification_required',
      message: 'Wallet verification required for this action.',
      role: 'guest',
      enforcement,
    };
  }

  if (!citizen && !verificationRequired && rule.allowGuestWhenOpen) {
    return {
      allowed: true,
      reason: 'open_circle_guest',
      role: 'guest',
      enforcement,
    };
  }

  const privileges = getPrivilegesForCitizen(citizen, state);
  if (privileges.banned) {
    return {
      allowed: false,
      reason: 'banned',
      message: 'Action blocked: this handle is banned in the Circle.',
      enforcement,
    };
  }

  if (rule.allowedRoles && !rule.allowedRoles.includes(privileges.role)) {
    return {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient role for this action.',
      role: privileges.role,
      enforcement,
    };
  }

  if (rule.minRole && rankRole(privileges.role) < rankRole(rule.minRole)) {
    return {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient privileges for this action.',
      role: privileges.role,
      enforcement,
    };
  }

  if (rule.capability && !privileges[rule.capability]) {
    return {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient privileges for this action.',
      role: privileges.role,
      enforcement,
    };
  }

  return { allowed: true, reason: 'ok', role: privileges.role, enforcement };
}

export function evaluateDiscussionPermission(state, citizen) {
  return evaluateAction(state, citizen, 'post');
}

export function summarizeGates(state, citizen) {
  return {
    post: evaluateAction(state, citizen, 'post'),
    petition: evaluateAction(state, citizen, 'petition'),
    vote: evaluateAction(state, citizen, 'vote'),
  };
}

export function buildPolicyGates(state) {
  return {
    guest: summarizeGates(state, null),
    citizen: summarizeGates(state, { role: 'citizen', sessionId: 'sample', pidHash: 'sample' }),
    delegate: summarizeGates(state, { role: 'delegate', sessionId: 'sample', pidHash: 'sample' }),
  };
}

function rankRole(role) {
  const idx = ROLE_ORDER.indexOf(role);
  return idx === -1 ? 0 : idx;
}
