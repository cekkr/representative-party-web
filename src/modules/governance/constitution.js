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

function normalizeNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}
