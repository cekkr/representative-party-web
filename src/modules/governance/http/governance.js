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
import { renderFormErrors } from '../../../interfaces/http/views/formFeedback.js';
import {
  FORM_OUTCOME,
  prefersHtmlNavigation,
  renderFlashNotice,
  renderOutcomeNotice,
  setFlashNotice,
} from '../../../interfaces/http/views/formOutcome.js';

// Fixed messages for the Propose a change panel, chosen by code only.
export const GOVERNANCE_NOTICES = Object.freeze({
  'proposal-submitted': {
    outcome: FORM_OUTCOME.APPLIED,
    message: 'Change proposal submitted. It stays advisory until the provider decides it.',
  },
});

export async function renderGovernance({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const proposalNotice = renderFlashNotice(req, res, 'governance', GOVERNANCE_NOTICES);
  return renderGovernancePage({ res, state, wantsPartial, person, proposalNotice });
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
    // A browser form gets the page back with the errors beside the form; the
    // typed title and reason stay so the member does not retype them.
    if (wantsPartial || prefersHtmlNavigation(req)) {
      return renderGovernancePage({
        res,
        state,
        wantsPartial,
        person,
        status: 400,
        proposalNotice: renderOutcomeNotice('The proposal was not submitted.', FORM_OUTCOME.NOT_APPLIED),
        proposalErrors: renderProposalErrors(result.errors),
        draft: body,
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

  // Post/Redirect/Get for both flows: a refresh cannot resubmit the proposal,
  // and the notice survives the redirect as a one-shot catalog code.
  setFlashNotice(res, 'governance', 'proposal-submitted');
  return sendRedirect(res, '/governance#governance-propose');
}

async function renderGovernancePage({
  res, state, wantsPartial, person, proposalNotice = '', proposalErrors = '', draft = null, status = 200,
}) {
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
      proposalNotice,
      proposalErrors,
      proposalTitleValue: escapeHtml(String(draft?.governanceProposalTitle || '').slice(0, 120)),
      proposalReasonValue: escapeHtml(String(draft?.governanceProposalReason || '').slice(0, 800)),
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
      governanceRules: renderCurrentRules(governance),
      governanceOpenCount: escapeHtml(`${openProposals.length} open`),
      proposeAction: person
        ? '<p class="workspace-heading__actions"><a class="cta" href="#governance-propose">Propose a change</a></p>'
        : '<p class="workspace-heading__actions"><a class="ghost" href="/auth/eudi" data-partial>Verify to propose a change</a></p>',
      governanceProposalList: renderGovernanceProposalList(openProposals, state),
      governanceHistoryList: renderGovernanceHistoryList(history, state),
    },
    { wantsPartial, title: 'Governance', state },
  );

  return sendHtml(res, html, {}, status);
}

const RULE_FIELDS = [
  'quorumDefault',
  'discussionWindowDays',
  'voteWindowDays',
  'reviewWindowHours',
  'defaultVoteMethod',
  'delegationDecayDays',
  'delegateVoteWindowDays',
];

const RULE_LABELS = {
  quorumDefault: 'Default quorum',
  discussionWindowDays: 'Discussion window',
  voteWindowDays: 'Vote window',
  reviewWindowHours: 'Review window',
  defaultVoteMethod: 'Default vote method',
  delegationDecayDays: 'Delegation decay',
  delegateVoteWindowDays: 'Delegate vote window',
};

function renderCurrentRules(governance) {
  const items = RULE_FIELDS.map((field) => `
    <div class="record-stats__item">
      <dt>${escapeHtml(RULE_LABELS[field])}</dt>
      <dd>${escapeHtml(formatRuleValue(field, governance[field]))}</dd>
    </div>`).join('');
  return `<dl class="record-stats record-stats--rules">${items}</dl>`;
}

function renderProposalErrors(errors = []) {
  return renderFormErrors(errors, { id: 'governance-proposal-errors', title: 'The proposal needs changes' });
}

// Values are stored raw (`0`, `majority`); members read rules.
const RULE_FORMATS = {
  quorumDefault: (value) => `${value} signatures`,
  discussionWindowDays: (value) => `${value} days`,
  voteWindowDays: (value) => `${value} days`,
  reviewWindowHours: (value) => `${value} hours`,
  delegationDecayDays: (value) => (Number(value) ? `${value} days without renewal` : 'Off'),
  delegateVoteWindowDays: (value) => (Number(value) ? `${value} days` : 'No deadline'),
};

function formatRuleValue(field, value) {
  if (value === undefined || value === null || value === '') return 'Not set';
  const format = RULE_FORMATS[field];
  return format ? format(value) : String(value);
}

// The current rule sits beside the proposed one, so a reader never has to
// remember the constitution to understand what a change does.
function renderRuleChange(changes = [], { current = null, decided = false } = {}) {
  if (!changes.length) return '';
  const firstHeading = decided ? 'Before' : 'Current rule';
  const secondHeading = decided ? 'After' : 'Proposed';
  const rows = changes
    .map((change) => {
      const before = current && !decided ? current[change.field] : change.from;
      return `<tr>
        <th scope="row">${escapeHtml(change.label || change.field)}</th>
        <td>${escapeHtml(formatRuleValue(change.field, before))}</td>
        <td>${escapeHtml(formatRuleValue(change.field, change.to))}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="table-scroll">
      <table class="rule-change">
        <thead><tr><th scope="col">Rule</th><th scope="col">${firstHeading}</th><th scope="col">${secondHeading}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderByline(state, hash, handle, fallback, at, prefix) {
  const date = formatTimestamp(at);
  return `<p class="muted small">${prefix} ${renderGovernanceActor(state, hash, handle, fallback)}${date ? ` · <time datetime="${escapeHtml(at)}">${escapeHtml(date)}</time>` : ''}</p>`;
}

function renderGovernanceProposalList(proposals = [], state) {
  if (!proposals.length) {
    return '<p class="muted">No change proposals are open. Any verified member can propose one.</p>';
  }
  const current = getGovernanceSettings(state);
  return `
    <ul class="discussion-list">
      ${proposals
        .map((proposal) => `
            <li>
              <article class="discussion stack" id="governance-proposal-${escapeHtml(proposal.id)}">
                <header>
                  <div class="topic-meta"><span class="pill stage--discussion">Open for decision</span></div>
                  <h3>${escapeHtml(proposal.title)}</h3>
                  ${renderByline(state, proposal.authorHash, proposal.authorHandle, 'a verified member', proposal.createdAt, 'Proposed by')}
                </header>
                ${proposal.reason ? `<p>${escapeHtml(proposal.reason)}</p>` : ''}
                ${renderRuleChange(proposal.changes || [], { current })}
              </article>
            </li>`)
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

const HISTORY_TONES = {
  proposal_approved: 'is-approved',
  proposal_rejected: 'is-rejected',
};

function renderGovernanceActor(state, hash, handle, fallback) {
  if (hash) return renderActorLabel(state, hash, { showHash: false });
  return escapeHtml(handle ? `@${handle}` : fallback);
}

function renderGovernanceHistoryList(history = [], state) {
  if (!history.length) {
    return '<p class="muted">No decisions recorded yet. Decided proposals and provider changes appear here.</p>';
  }
  const proposals = Array.isArray(state?.settings?.governanceProposals) ? state.settings.governanceProposals : [];
  const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  return `
    <ul class="discussion-list">
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
          const date = formatTimestamp(entry.at);
          const effect = proposal && entry.type === 'proposal_approved'
            ? renderRuleChange(proposal.changes || [], { decided: true })
            : '';
          return `
            <li>
              <article class="discussion decision-entry ${HISTORY_TONES[entry.type] || ''} stack">
                <h3>${escapeHtml(label)}${title}</h3>
                <p class="muted small">${proposer}decided by ${decider}${date ? ` · <time datetime="${escapeHtml(entry.at)}">${escapeHtml(date)}</time>` : ''}</p>
                ${proposal?.reason ? `<p>${escapeHtml(proposal.reason)}</p>` : ''}
                ${effect || (entry.summary ? `<p class="muted small">${escapeHtml(entry.summary).replace(/ -&gt; /g, ' → ')}</p>` : '')}
              </article>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}
