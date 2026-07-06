import { randomUUID } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';

const DEFAULT_GOVERNANCE = {
  quorumDefault: 20,
  discussionWindowDays: 14,
  voteWindowDays: 7,
  reviewWindowHours: 24,
  defaultVoteMethod: 'majority',
  delegationDecayDays: 0,
  notes: '',
  updatedAt: null,
  updatedBy: null,
};

export const GOVERNANCE_FIELDS = [
  'quorumDefault',
  'discussionWindowDays',
  'voteWindowDays',
  'reviewWindowHours',
  'defaultVoteMethod',
  'delegationDecayDays',
  'notes',
];

const FIELD_LABELS = {
  quorumDefault: 'Default quorum',
  discussionWindowDays: 'Discussion window',
  voteWindowDays: 'Vote window',
  reviewWindowHours: 'Review window',
  defaultVoteMethod: 'Default vote method',
  delegationDecayDays: 'Delegation decay',
  notes: 'Governance notes',
};

const ALLOWED_VOTE_METHODS = new Set(['majority', 'approval', 'ranked', 'condorcet', 'star']);

export function getGovernanceSettings(state) {
  const saved = state?.settings?.governance || {};
  return normalizeGovernanceSettings(saved);
}

export function normalizeGovernanceSettings(input = {}) {
  const quorumDefault = normalizeNumber(input.quorumDefault, DEFAULT_GOVERNANCE.quorumDefault, { min: 0, max: 100000 });
  const discussionWindowDays = normalizeNumber(input.discussionWindowDays, DEFAULT_GOVERNANCE.discussionWindowDays, {
    min: 0,
    max: 365,
  });
  const voteWindowDays = normalizeNumber(input.voteWindowDays, DEFAULT_GOVERNANCE.voteWindowDays, { min: 0, max: 365 });
  const reviewWindowHours = normalizeNumber(input.reviewWindowHours, DEFAULT_GOVERNANCE.reviewWindowHours, {
    min: 0,
    max: 168,
  });
  const rawVoteMethod = sanitizeText(input.defaultVoteMethod || DEFAULT_GOVERNANCE.defaultVoteMethod, 32).toLowerCase();
  const defaultVoteMethod = ALLOWED_VOTE_METHODS.has(rawVoteMethod)
    ? rawVoteMethod
    : DEFAULT_GOVERNANCE.defaultVoteMethod;
  const delegationDecayDays = normalizeNumber(input.delegationDecayDays, DEFAULT_GOVERNANCE.delegationDecayDays, {
    min: 0,
    max: 3650,
  });
  return {
    quorumDefault,
    discussionWindowDays,
    voteWindowDays,
    reviewWindowHours,
    defaultVoteMethod,
    delegationDecayDays,
    notes: sanitizeText(input.notes || DEFAULT_GOVERNANCE.notes, 400),
    updatedAt: input.updatedAt || null,
    updatedBy: input.updatedBy || null,
  };
}

export function isGovernanceVoteMethodAllowed(value) {
  return ALLOWED_VOTE_METHODS.has(String(value || '').toLowerCase());
}

export function listGovernanceProposals(state, { status, limit = 20 } = {}) {
  const proposals = Array.isArray(state?.settings?.governanceProposals) ? state.settings.governanceProposals : [];
  const filtered = status ? proposals.filter((proposal) => proposal.status === status) : proposals;
  return filtered.slice(0, limit);
}

export function listGovernanceHistory(state, { limit = 20 } = {}) {
  const history = Array.isArray(state?.settings?.governanceHistory) ? state.settings.governanceHistory : [];
  return history.slice(0, limit);
}

export function createGovernanceProposal(state, input = {}, actor = {}) {
  const base = getGovernanceSettings(state);
  const title = sanitizeText(input.title || input.governanceProposalTitle || '', 120);
  const reason = sanitizeText(input.reason || input.governanceProposalReason || '', 800);
  const rawVoteMethod = readInputField(input, 'defaultVoteMethod', 'governanceProposalVoteMethod');
  const candidate = normalizeGovernanceSettings({
    ...base,
    quorumDefault: readInputField(input, 'quorumDefault', 'governanceProposalQuorumDefault', base.quorumDefault),
    discussionWindowDays: readInputField(
      input,
      'discussionWindowDays',
      'governanceProposalDiscussionWindowDays',
      base.discussionWindowDays,
    ),
    voteWindowDays: readInputField(input, 'voteWindowDays', 'governanceProposalVoteWindowDays', base.voteWindowDays),
    reviewWindowHours: readInputField(input, 'reviewWindowHours', 'governanceProposalReviewWindowHours', base.reviewWindowHours),
    defaultVoteMethod: rawVoteMethod === undefined ? base.defaultVoteMethod : rawVoteMethod,
    delegationDecayDays: readInputField(
      input,
      'delegationDecayDays',
      'governanceProposalDelegationDecayDays',
      base.delegationDecayDays,
    ),
    notes: readInputField(input, 'notes', 'governanceProposalNotes', base.notes),
  });
  const changes = diffGovernanceSettings(base, candidate);
  const errors = [];

  if (!actor?.pidHash) errors.push('Verified session required to propose governance changes.');
  if (!title) errors.push('Proposal title is required.');
  if (!reason) errors.push('Proposal reason is required.');
  if (rawVoteMethod !== undefined && !isGovernanceVoteMethodAllowed(rawVoteMethod)) {
    errors.push('Default vote method must be one of: majority, approval, ranked, condorcet, star.');
  }
  if (!changes.length) errors.push('At least one governance default must change.');

  if (errors.length) return { ok: false, errors };

  const now = new Date().toISOString();
  const proposal = {
    id: randomUUID(),
    title,
    reason,
    status: 'open',
    createdAt: now,
    authorHash: actor.pidHash,
    authorHandle: sanitizeText(actor.handle || '', 80),
    proposed: pickGovernanceFields(candidate),
    changes,
  };
  const settings = state.settings || {};
  const proposals = Array.isArray(settings.governanceProposals) ? settings.governanceProposals : [];
  state.settings = {
    ...settings,
    governanceProposals: [proposal, ...proposals].slice(0, 100),
  };
  return { ok: true, proposal };
}

export function decideGovernanceProposal(state, proposalId, { decision = 'reject', actorHash, actorHandle } = {}) {
  const settings = state.settings || {};
  const proposals = Array.isArray(settings.governanceProposals) ? settings.governanceProposals : [];
  const index = proposals.findIndex((proposal) => proposal.id === proposalId);
  if (index === -1) return { ok: false, error: 'not_found' };

  const proposal = proposals[index];
  if (proposal.status !== 'open') return { ok: false, error: 'already_decided', proposal };

  const now = new Date().toISOString();
  const approved = decision === 'approve' || decision === 'approved';
  const decided = {
    ...proposal,
    status: approved ? 'approved' : 'rejected',
    decidedAt: now,
    decidedBy: actorHandle || actorHash || 'admin',
    decidedByHash: actorHash || null,
  };
  const nextProposals = [...proposals];
  nextProposals[index] = decided;

  let nextGovernance = settings.governance;
  if (approved) {
    nextGovernance = normalizeGovernanceSettings({
      ...getGovernanceSettings(state),
      ...proposal.proposed,
      updatedAt: now,
      updatedBy: decided.decidedBy,
    });
  }

  state.settings = {
    ...settings,
    governance: nextGovernance,
    governanceProposals: nextProposals,
  };
  recordGovernanceHistory(state, {
    type: approved ? 'proposal_approved' : 'proposal_rejected',
    proposal: decided,
    actorHash,
    actorHandle,
    changes: proposal.changes || [],
  });

  return { ok: true, proposal: decided, governance: nextGovernance };
}

export function recordGovernanceHistory(state, entry = {}) {
  const settings = state.settings || {};
  const history = Array.isArray(settings.governanceHistory) ? settings.governanceHistory : [];
  const stamped = {
    id: entry.id || randomUUID(),
    at: entry.at || new Date().toISOString(),
    type: sanitizeText(entry.type || 'governance_update', 80),
    proposalId: entry.proposal?.id || entry.proposalId || null,
    title: sanitizeText(entry.proposal?.title || entry.title || '', 120),
    actorHash: entry.actorHash || null,
    actorHandle: sanitizeText(entry.actorHandle || '', 80),
    changes: Array.isArray(entry.changes) ? entry.changes.map(normalizeChangeEntry).filter(Boolean) : [],
    summary: sanitizeText(entry.summary || summarizeGovernanceChanges(entry.changes || []), 240),
  };
  state.settings = {
    ...settings,
    governanceHistory: [stamped, ...history].slice(0, 100),
  };
  return stamped;
}

export function diffGovernanceSettings(previous = {}, next = {}) {
  const before = normalizeGovernanceSettings(previous);
  const after = normalizeGovernanceSettings(next);
  return GOVERNANCE_FIELDS.flatMap((field) => {
    if (String(before[field] ?? '') === String(after[field] ?? '')) return [];
    return [
      {
        field,
        label: FIELD_LABELS[field] || field,
        from: before[field],
        to: after[field],
      },
    ];
  });
}

export function summarizeGovernanceChanges(changes = []) {
  const parts = (changes || []).map((change) => `${change.label || change.field}: ${change.from ?? ''} -> ${change.to ?? ''}`);
  return parts.join('; ');
}

function normalizeNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function readInputField(input, key, formKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  if (Object.prototype.hasOwnProperty.call(input, formKey)) return input[formKey];
  return fallback;
}

function pickGovernanceFields(settings) {
  const picked = {};
  for (const field of GOVERNANCE_FIELDS) {
    picked[field] = settings[field];
  }
  return picked;
}

function normalizeChangeEntry(change = {}) {
  const field = sanitizeText(change.field || '', 80);
  if (!field) return null;
  return {
    field,
    label: sanitizeText(change.label || FIELD_LABELS[field] || field, 80),
    from: change.from,
    to: change.to,
  };
}
