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
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

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
      proposalNotes: escapeHtml(governance.notes || ''),
      governanceProposalList: renderGovernanceProposalList(openProposals),
      governanceHistoryList: renderGovernanceHistoryList(history),
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

function renderGovernanceProposalList(proposals = []) {
  if (!proposals.length) {
    return '<p class="muted small">No open governance proposals.</p>';
  }
  return `
    <ul class="stack">
      ${proposals
        .map((proposal) => {
          const changes = renderChangeList(proposal.changes || []);
          const author = proposal.authorHandle || String(proposal.authorHash || '').slice(0, 12) || 'verified user';
          return `
            <li class="callout">
              <strong>${escapeHtml(proposal.title)}</strong>
              <p class="muted small">${escapeHtml(proposal.reason)}</p>
              <p class="muted small">Proposed by ${escapeHtml(author)} on ${escapeHtml(formatTimestamp(proposal.createdAt))}</p>
              ${changes}
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

function renderGovernanceHistoryList(history = []) {
  if (!history.length) {
    return '<p class="muted small">No governance history entries yet.</p>';
  }
  return `
    <ul class="stack">
      ${history
        .map((entry) => {
          const actor = entry.actorHandle || String(entry.actorHash || '').slice(0, 12) || 'admin';
          const title = entry.title ? ` - ${escapeHtml(entry.title)}` : '';
          return `
            <li class="callout">
              <strong>${escapeHtml(entry.type)}${title}</strong>
              <p class="muted small">${escapeHtml(entry.summary || '')}</p>
              <p class="muted small">${escapeHtml(formatTimestamp(entry.at))} by ${escapeHtml(actor)}</p>
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
