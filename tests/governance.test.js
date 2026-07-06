import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createGovernanceProposal,
  decideGovernanceProposal,
  getGovernanceSettings,
  listGovernanceHistory,
  normalizeGovernanceSettings,
} from '../src/modules/governance/constitution.js';
import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('normalizeGovernanceSettings clamps ranges and defaults the vote method', () => {
  const normalized = normalizeGovernanceSettings({
    quorumDefault: -5,
    discussionWindowDays: 500,
    voteWindowDays: 'bad',
    reviewWindowHours: 999,
    defaultVoteMethod: 'unknown',
    notes: '  Keep it short  ',
  });

  assert.equal(normalized.quorumDefault, 0);
  assert.equal(normalized.discussionWindowDays, 365);
  assert.equal(normalized.voteWindowDays, 7);
  assert.equal(normalized.reviewWindowHours, 168);
  assert.equal(normalized.defaultVoteMethod, 'majority');
  assert.equal(normalized.notes, 'Keep it short');
});

test('getGovernanceSettings falls back to defaults when settings are missing', () => {
  const settings = getGovernanceSettings({});
  assert.equal(settings.quorumDefault, 20);
  assert.equal(settings.discussionWindowDays, 14);
  assert.equal(settings.voteWindowDays, 7);
  assert.equal(settings.reviewWindowHours, 24);
  assert.equal(settings.defaultVoteMethod, 'majority');
});

test('governance proposals diff defaults and approvals update history', () => {
  const state = {
    settings: {
      governance: normalizeGovernanceSettings({ quorumDefault: 20, notes: 'Old notes' }),
    },
  };

  const result = createGovernanceProposal(
    state,
    {
      governanceProposalTitle: 'Lower pilot quorum',
      governanceProposalReason: 'Small local pilots need a smaller starter quorum.',
      governanceProposalQuorumDefault: '12',
      governanceProposalNotes: 'Pilot governance defaults',
    },
    { pidHash: 'hash-1', handle: 'person-hash1' },
  );

  assert.equal(result.ok, true);
  assert.equal(result.proposal.status, 'open');
  assert.deepEqual(
    result.proposal.changes.map((change) => change.field),
    ['quorumDefault', 'notes'],
  );

  const decision = decideGovernanceProposal(state, result.proposal.id, {
    decision: 'approve',
    actorHash: 'admin-hash',
    actorHandle: 'admin',
  });

  assert.equal(decision.ok, true);
  assert.equal(getGovernanceSettings(state).quorumDefault, 12);
  assert.equal(state.settings.governanceProposals[0].status, 'approved');
  const history = listGovernanceHistory(state);
  assert.equal(history[0].type, 'proposal_approved');
  assert.equal(history[0].proposalId, result.proposal.id);
});

test('verified users can propose governance changes and admin approval updates the public constitution', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'governance-proposer' });
  const proposalResponse = await postForm(
    `${server.baseUrl}/governance/proposals`,
    {
      governanceProposalTitle: 'Pilot quorum update',
      governanceProposalReason: 'Local pilots need a lower initial quorum.',
      governanceProposalQuorumDefault: '9',
      governanceProposalDiscussionWindowDays: '14',
      governanceProposalVoteWindowDays: '7',
      governanceProposalReviewWindowHours: '24',
      governanceProposalVoteMethod: 'majority',
      governanceProposalDelegationDecayDays: '0',
      governanceProposalNotes: '',
    },
    { cookie: session.cookie, partial: true },
  );
  assert.equal(proposalResponse.status, 200);
  const proposalHtml = await proposalResponse.text();
  assert.match(proposalHtml, /Pilot quorum update/);

  const { text: adminText } = await fetchText(`${server.baseUrl}/admin`);
  const idMatch = adminText.match(/name="proposalId" value="([^"]+)"/);
  assert.ok(idMatch, 'admin page should expose the proposal decision form');

  const approveResponse = await postForm(
    `${server.baseUrl}/admin`,
    {
      intent: 'governance-proposal-decision',
      proposalId: idMatch[1],
      decision: 'approve',
    },
    { partial: true },
  );
  assert.equal(approveResponse.status, 200);
  const approveHtml = await approveResponse.text();
  assert.match(approveHtml, /Governance proposal approved and defaults updated/);

  const { text: governanceText } = await fetchText(`${server.baseUrl}/governance`);
  assert.match(governanceText, /Default quorum: 9/);
  assert.match(governanceText, /proposal_approved/);
});
