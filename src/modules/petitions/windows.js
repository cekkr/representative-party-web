import { getGovernanceSettings } from '../governance/constitution.js';
import { filterVisibleEntries } from '../federation/replication.js';
import { canReadProposal } from './proposalLinks.js';

// The constitution's discussion and vote windows are published guidance.
// Nothing ends discussion or closes voting when they pass — a moderator does.
// These helpers say where a proposal stands against its window so the
// workspace can show it and moderators can find the ones that are due.

export const DAY_MS = 1000 * 60 * 60 * 24;

export function normalizeProposalStage(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'open' || normalized === 'vote') return 'vote';
  if (normalized === 'discussion' || normalized === 'closed') return normalized;
  return 'draft';
}

// When the current stage began: discussion records `discussionOpenedAt`
// (migration 30); voting begins with the freeze snapshot.
export function stageOpenedAt(proposal) {
  const stage = normalizeProposalStage(proposal?.status);
  if (stage === 'discussion') return proposal.discussionOpenedAt || null;
  if (stage === 'vote') return proposal.freeze?.frozenAt || null;
  return null;
}

// Where the proposal stands against the window for its current stage, or null
// when the stage has no window (draft, closed). `known` is false when the stage
// began before its opening time was recorded, so no due date can be given.
export function describeProposalWindow(state, proposal, now = Date.now()) {
  const stage = normalizeProposalStage(proposal?.status);
  if (stage !== 'discussion' && stage !== 'vote') return null;
  const governance = getGovernanceSettings(state);
  const windowDays = Number(stage === 'vote' ? governance.voteWindowDays : governance.discussionWindowDays) || 0;
  const openedAt = stageOpenedAt(proposal);
  const openedMs = openedAt ? Date.parse(openedAt) : NaN;
  const base = { stage, windowDays, openedAt: Number.isFinite(openedMs) ? openedAt : null };
  if (!windowDays || !Number.isFinite(openedMs)) {
    return { ...base, known: false, dueAt: null, daysLeft: null, elapsed: false, daysOver: 0 };
  }
  const dueMs = openedMs + windowDays * DAY_MS;
  const daysLeft = Math.ceil((dueMs - now) / DAY_MS);
  const elapsed = now >= dueMs;
  return {
    ...base,
    known: true,
    dueAt: new Date(dueMs).toISOString(),
    daysLeft,
    elapsed,
    daysOver: elapsed ? Math.floor((now - dueMs) / DAY_MS) : 0,
  };
}

// Proposals whose current window has elapsed, most overdue first, limited to
// what this viewer could open. A moderator acts on them; nothing here does.
export function listProposalsPastWindow(state, person, { now = Date.now(), limit = 8 } = {}) {
  const due = [];
  for (const proposal of filterVisibleEntries(state.petitions || [], state)) {
    const window = describeProposalWindow(state, proposal, now);
    if (!window?.known || !window.elapsed) continue;
    if (!canReadProposal(state, person, proposal)) continue;
    due.push({ proposal, window });
  }
  due.sort((a, b) => Date.parse(a.window.dueAt) - Date.parse(b.window.dueAt));
  return { total: due.length, items: due.slice(0, limit) };
}
