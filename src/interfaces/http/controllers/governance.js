import { getPerson } from '../../../modules/identity/person.js';
import { getGovernanceSettings } from '../../../modules/governance/constitution.js';
import { sendHtml } from '../../../shared/utils/http.js';
import { formatTimestamp } from '../../../shared/utils/time.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { renderPage } from '../views/templates.js';
import { resolvePersonHandle } from '../views/actorLabel.js';

export async function renderGovernance({ req, res, state, wantsPartial }) {
  const person = getPerson(req, state);
  const governance = getGovernanceSettings(state);
  const updatedAt = formatTimestamp(governance.updatedAt) || 'Not yet updated';
  const updatedBy = governance.updatedBy || 'admin';

  const html = await renderPage(
    'governance',
    {
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      quorumDefault: escapeHtml(String(governance.quorumDefault)),
      discussionWindowDays: escapeHtml(String(governance.discussionWindowDays)),
      voteWindowDays: escapeHtml(String(governance.voteWindowDays)),
      reviewWindowHours: escapeHtml(String(governance.reviewWindowHours)),
      defaultVoteMethod: escapeHtml(governance.defaultVoteMethod),
      governanceNotes: escapeHtml(governance.notes || 'No governance notes published yet.'),
      governanceUpdatedAt: escapeHtml(updatedAt),
      governanceUpdatedBy: escapeHtml(updatedBy),
    },
    { wantsPartial, title: 'Governance', state },
  );

  return sendHtml(res, html);
}
