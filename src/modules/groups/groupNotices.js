import { FORM_OUTCOME } from '../../interfaces/http/views/formOutcome.js';

const { APPLIED, PARTIAL, NOT_APPLIED } = FORM_OUTCOME;

// Fixed messages for group writes, chosen by code only. A write that returns to
// its group section names what happened there; a refusal says nothing changed.
export const GROUP_NOTICES = Object.freeze({
  created: { outcome: APPLIED, message: 'Group created. You are its first admin.' },
  joined: { outcome: APPLIED, message: 'You joined this group.' },
  left: { outcome: APPLIED, message: 'You left this group.' },
  'election-started': { outcome: APPLIED, message: 'Election opened. Members can rank candidates in Decisions.' },
  'ballot-cast': { outcome: APPLIED, message: 'Your ranked ballot is recorded. You can change it until the election closes.' },
  'election-closed': { outcome: APPLIED, message: 'Election closed. The winner is now this group’s delegate for its category.' },
  'election-closed-no-winner': {
    outcome: PARTIAL,
    message: 'Election closed without a winner, so the group’s delegate did not change.',
  },
  'delegate-saved': { outcome: APPLIED, message: 'Preferred delegate saved. Recommendations stay advisory.' },
  'role-saved': { outcome: APPLIED, message: 'Member role updated.' },
  'categories-saved': { outcome: APPLIED, message: 'Group categories saved.' },
  'policy-saved': { outcome: APPLIED, message: 'Group rules saved.' },
  'not-applied': { outcome: NOT_APPLIED, message: 'Nothing changed. The record may have moved or closed; check it before trying again.' },
  'verify-required': { outcome: NOT_APPLIED, message: 'Verify your identity to take part in groups. Nothing changed.' },
  'not-allowed': { outcome: NOT_APPLIED, message: 'Your account cannot do that here right now. Nothing changed.' },
  'not-found': { outcome: NOT_APPLIED, message: 'That group or election no longer exists. Nothing changed.' },
  'admin-required': { outcome: NOT_APPLIED, message: 'Only a group admin or a Circle moderator can do that. Nothing changed.' },
  'membership-required': { outcome: NOT_APPLIED, message: 'Join the group to vote in its elections. Nothing changed.' },
  'parent-invalid': {
    outcome: NOT_APPLIED,
    message: 'That parent group cannot hold this branch (missing, a cycle, or too deep). The group was not created.',
  },
  'role-refused': {
    outcome: NOT_APPLIED,
    message: 'That role change was refused. The person must already be a member, and a group always keeps at least one admin.',
  },
});

const ERROR_CODES = {
  verification_required: 'verify-required',
  group_not_found: 'not-found',
  election_not_found: 'not-found',
  parent_not_found: 'parent-invalid',
  group_admin_required: 'admin-required',
  group_membership_required: 'membership-required',
};

// Maps a structured refusal onto a catalog code. Parent and role refusals come
// from domain validators with their own error names, so the caller passes a
// family hint for those.
export function groupRefusalCode(error, family = '') {
  if (ERROR_CODES[error]) return ERROR_CODES[error];
  if (family === 'parent') return 'parent-invalid';
  if (family === 'role') return 'role-refused';
  return 'not-allowed';
}
