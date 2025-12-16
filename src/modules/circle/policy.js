import { POLICIES } from '../../config.js';
import { getPrivilegesForCitizen } from '../identity/privileges.js';

const ROLE_ORDER = ['guest', 'citizen', 'delegate', 'moderator', 'admin'];

const BASE_ACTION_RULES = {
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
  const rules = resolveActionRules(state);
  const rule = rules[action] || rules.post;
  const enforcement = policy.enforceCircle ? 'strict' : 'observing';
  const verificationRequired = rule.requireVerification ?? policy.requireVerification;

  if (!citizen && verificationRequired) {
    return decorateDecision(state, {
      allowed: false,
      reason: 'verification_required',
      message: 'Wallet verification required for this action.',
      role: 'guest',
      enforcement,
      action,
    });
  }

  if (!citizen && !verificationRequired && rule.allowGuestWhenOpen) {
    return decorateDecision(state, {
      allowed: true,
      reason: 'open_circle_guest',
      role: 'guest',
      enforcement,
      action,
    });
  }

  const privileges = getPrivilegesForCitizen(citizen, state);
  if (privileges.banned) {
    return decorateDecision(state, {
      allowed: false,
      reason: 'banned',
      message: 'Action blocked: this handle is banned in the Circle.',
      enforcement,
      role: privileges.role,
      action,
    });
  }

  if (rule.allowedRoles && !rule.allowedRoles.includes(privileges.role)) {
    return decorateDecision(state, {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient role for this action.',
      role: privileges.role,
      enforcement,
      action,
    });
  }

  if (rule.minRole && rankRole(privileges.role) < rankRole(rule.minRole)) {
    return decorateDecision(state, {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient privileges for this action.',
      role: privileges.role,
      enforcement,
      action,
    });
  }

  if (rule.capability && !privileges[rule.capability]) {
    return decorateDecision(state, {
      allowed: false,
      reason: 'insufficient_privileges',
      message: 'Action blocked: insufficient privileges for this action.',
      role: privileges.role,
      enforcement,
      action,
    });
  }

  return decorateDecision(state, { allowed: true, reason: 'ok', role: privileges.role, enforcement, action });
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

function resolveActionRules(state) {
  const extensions = state?.extensions?.active || [];
  let rules = { ...BASE_ACTION_RULES };
  for (const extension of extensions) {
    if (typeof extension.extendActionRules === 'function') {
      const next = extension.extendActionRules({ ...rules }, state);
      if (next && typeof next === 'object') {
        rules = { ...rules, ...next };
      }
    }
  }
  return rules;
}

function decorateDecision(state, decision) {
  const extensions = state?.extensions?.active || [];
  let current = { ...decision };
  for (const extension of extensions) {
    if (typeof extension.decorateDecision === 'function') {
      current = extension.decorateDecision(current, state) || current;
    }
  }
  return current;
}
