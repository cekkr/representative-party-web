import { getPerson } from '../../identity/person.js';
import { evaluateAction } from '../../circle/policy.js';
import {
  createGovernanceProposal,
  getGovernanceSettings,
  listGovernanceHistory,
  listGovernanceProposals,
} from '../../governance/constitution.js';
import { logTransaction } from '../../transactions/registry.js';
import { persistSettings } from '../../../infra/persistence/storage.js';
import { sendHtml, sendJson, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderActorLabel, resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

export async function renderGovernance({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  return renderGovernancePage({ res, state, wantsPartial, person });
}

export async function proposeGovernanceChange({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const permission = evaluateAction(state, person, 'post');
  if (!person) {
    return sendJson(res, 401, { error: 'verification_required', message: 'Wallet verification required to propose governance changes.' });
  }
  if (!permission.allowed) {
    return sendJson(res, 403, { error: permission.reason, message: permission.message || 'Governance proposal blocked.' });
  }

  const body = await readRequestBody(req);
  const result = createGovernanceProposal(state, body, person);
  if (!result.ok) {
    if (wantsPartial) {
      return renderGovernancePage({
        res,
        state,
        wantsPartial,
        person,
        proposalErrors: renderProposalErrors(result.errors),
      });
    }
    return sendJson(res, 400, { error: 'invalid_governance_proposal', messages: result.errors });
  }

  await persistSettings(state);
  await logTransaction(state, {
    type: 'governance_proposal',
    actorHash: person.pidHash,
    payload: {
      proposalId: result.proposal.id,
      title: result.proposal.title,
      changes: result.proposal.changes.map((change) => change.field),
    },
  });

  if (wantsPartial) {
    return renderGovernancePage({
      res,
      state,
      wantsPartial,
      person,
      flash: 'Governance change proposal submitted.',
    });
  }
  return sendRedirect(res, '/governance');
}

async function renderGovernancePage({ res, state, wantsPartial, person, flash = '', proposalErrors = '' }) {
  const governance = getGovernanceSettings(state);
  const updatedAt = formatTimestamp(governance.updatedAt) || 'Not yet updated';
  const updatedBy = governance.updatedBy || 'admin';
  const openProposals = listGovernanceProposals(state, { status: 'open', limit: 10 });
  const history = listGovernanceHistory(state, { limit: 10 });

  const html = await renderPage(
    'governance',
    {
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      quorumDefault: escapeHtml(String(governance.quorumDefault)),
      discussionWindowDays: escapeHtml(String(governance.discussionWindowDays)),
      voteWindowDays: escapeHtml(String(governance.voteWindowDays)),
      reviewWindowHours: escapeHtml(String(governance.reviewWindowHours)),
      defaultVoteMethod: escapeHtml(governance.defaultVoteMethod),
      delegationDecayDays: escapeHtml(
        governance.delegationDecayDays
          ? `${governance.delegationDecayDays} day(s) without renewal`
          : 'Off (delegations stay active until cleared)',
      ),
      delegateVoteWindowDays: escapeHtml(
        governance.delegateVoteWindowDays
          ? `${governance.delegateVoteWindowDays} day(s) for a delegate to cast a delegated ballot`
          : 'Off (a delegated ballot waits until the delegate votes)',
      ),
      governanceNotes: escapeHtml(governance.notes || 'No governance notes published yet.'),
      governanceUpdatedAt: escapeHtml(updatedAt),
      governanceUpdatedBy: escapeHtml(updatedBy),
      proposalFlash: escapeHtml(flash),
      proposalErrors,
      proposalDisabled: person ? '' : 'disabled',
      proposalHelp: person
        ? 'Proposals stay advisory until an admin accepts or rejects them.'
        : 'Verify your wallet to propose constitution changes.',
      proposalQuorumDefault: escapeHtml(String(governance.quorumDefault)),
      proposalDiscussionWindowDays: escapeHtml(String(governance.discussionWindowDays)),
      proposalVoteWindowDays: escapeHtml(String(governance.voteWindowDays)),
      proposalReviewWindowHours: escapeHtml(String(governance.reviewWindowHours)),
      proposalVoteMethodMajority: governance.defaultVoteMethod === 'majority' ? 'selected' : '',
      proposalVoteMethodApproval: governance.defaultVoteMethod === 'approval' ? 'selected' : '',
      proposalVoteMethodRanked: governance.defaultVoteMethod === 'ranked' ? 'selected' : '',
      proposalVoteMethodCondorcet: governance.defaultVoteMethod === 'condorcet' ? 'selected' : '',
      proposalVoteMethodStar: governance.defaultVoteMethod === 'star' ? 'selected' : '',
      proposalDelegationDecayDays: escapeHtml(String(governance.delegationDecayDays)),
      proposalDelegateVoteWindowDays: escapeHtml(String(governance.delegateVoteWindowDays)),
      proposalNotes: escapeHtml(governance.notes || ''),
      governanceProposalList: renderGovernanceProposalList(openProposals, state),
      governanceHistoryList: renderGovernanceHistoryList(history, state),
    },
    { wantsPartial, title: 'Governance', state },
  );

  return sendHtml(res, html);
}

function renderProposalErrors(errors = []) {
  if (!errors.length) return '';
  return `
    <div class="callout warning">
      ${errors.map((error) => `<p class="muted small">${escapeHtml(error)}</p>`).join('')}
    </div>
  `;
}

function renderGovernanceProposalList(proposals = [], state) {
  if (!proposals.length) {
    return '<p class="muted small">No open governance proposals.</p>';
  }
  return `
    <ul class="callout-list">
      ${proposals
        .map((proposal) => {
          const changes = renderChangeList(proposal.changes || []);
          return `
            <li class="callout">
              <strong>${escapeHtml(proposal.title)}</strong>
              <p class="muted small">${escapeHtml(proposal.reason)}</p>
              <p class="muted small">Proposed by ${renderGovernanceActor(state, proposal.authorHash, proposal.authorHandle, 'a verified member')} · ${escapeHtml(formatTimestamp(proposal.createdAt))}</p>
              ${changes}
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

// History entries store event types (`proposal_approved`); members read decisions.
const HISTORY_LABELS = {
  proposal_approved: 'Approved',
  proposal_rejected: 'Rejected',
  governance_update: 'Changed by the provider',
  admin_update: 'Set by the provider',
};

function renderGovernanceActor(state, hash, handle, fallback) {
  if (hash) return renderActorLabel(state, hash, { showHash: false });
  return escapeHtml(handle ? `@${handle}` : fallback);
}

function renderGovernanceHistoryList(history = [], state) {
  if (!history.length) {
    return '<p class="muted small">No governance history entries yet.</p>';
  }
  const proposals = Array.isArray(state?.settings?.governanceProposals) ? state.settings.governanceProposals : [];
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  return `
    <ul class="callout-list">
      ${history
        .map((entry) => {
          const label = HISTORY_LABELS[entry.type] || String(entry.type || 'Update').replace(/_/g, ' ');
          const title = entry.title ? ` — ${escapeHtml(entry.title)}` : '';
          const proposal = entry.proposalId ? byId.get(entry.proposalId) : null;
          // Who asked and who decided are different people; the record keeps both, so a
          // provider decision on a member's proposal is never presented as the member's own.
          const proposer = proposal
            ? `Proposed by ${renderGovernanceActor(state, proposal.authorHash, proposal.authorHandle, 'a verified member')} · `
            : '';
          const decider = renderGovernanceActor(state, entry.actorHash, entry.actorHandle, 'the provider');
          const reason = proposal?.reason ? `<p class="muted small">${escapeHtml(proposal.reason)}</p>` : '';
          return `
            <li class="callout">
              <strong>${escapeHtml(label)}${title}</strong>
              ${reason}
              <p class="muted small">${escapeHtml(entry.summary || '')}</p>
              <p class="muted small">${proposer}decided by ${decider} · ${escapeHtml(formatTimestamp(entry.at))}</p>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

function renderChangeList(changes = []) {
  if (!changes.length) return '';
  return `
    <ul class="small">
      ${changes
        .map(
          (change) =>
            `<li>${escapeHtml(change.label || change.field)}: ${escapeHtml(String(change.from ?? ''))} -> ${escapeHtml(
              String(change.to ?? ''),
            )}</li>`,
        )
        .join('')}
    </ul>
  `;
}
