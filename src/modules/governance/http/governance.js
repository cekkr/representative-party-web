import { getPerson } from '../../identity/person.js';
import { getGovernanceSettings } from '../../governance/constitution.js';
import { sendHtml } from '../../../shared/utils/http.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';

export async function renderGovernance({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const governance = getGovernanceSettings(state);
  const updatedAt = formatTimestamp(governance.updatedAt) || 'Not yet updated';
  const updatedBy = governance.updatedBy || 'admin';

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
    },
    { wantsPartial, title: 'Governance', state },
  );

  return sendHtml(res, html);
}
