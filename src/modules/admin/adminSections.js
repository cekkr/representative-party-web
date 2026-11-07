import { escapeHtml } from '../../shared/utils/text.js';
import { renderFormNotice } from '../../interfaces/http/views/formFeedback.js';

// The admin page is one long settings document. These groups give it a stable
// index (the same anchors the partials already use as ids and Composer keys) and
// tell each POST which section it belongs to, so the confirmation renders beside
// the form that was submitted instead of at the top of a 20-panel page.
export const ADMIN_SECTION_GROUPS = [
  { label: 'Setup', sections: [['circle-settings', 'Circle settings'], ['governance-settings', 'Governance defaults']] },
  { label: 'Modules and appearance', sections: [['modules', 'Modules'], ['composer', 'Composer']] },
  { label: 'Policy', sections: [['rate-limits', 'Rate limits'], ['social-media', 'Media moderation'], ['upload-cleanup', 'Upload cleanup']] },
  { label: 'Structure', sections: [['structure-manager', 'Profile schema'], ['provider-profiles', 'Profile data'], ['topic-gardener-review', 'Topic gardener']] },
  { label: 'Federation', sections: [['federation-gossip', 'Gossip sync'], ['provider-blind', 'Provider-blind']] },
  {
    label: 'Observability',
    sections: [
      ['admin-audit', 'Audit'],
      ['ops-metrics', 'Runtime metrics'],
      ['metrics-retention', 'Metrics retention'],
      ['admin-transactions', 'Transactions'],
      ['outbound-delivery', 'Outbound delivery'],
      ['transaction-summaries', 'Transaction summaries'],
    ],
  },
  { label: 'People and extensions', sections: [['session-overrides', 'Roles and bans'], ['extensions', 'Extensions']] },
];

export const ADMIN_SECTION_IDS = ADMIN_SECTION_GROUPS.flatMap((group) => group.sections.map(([id]) => id));

const INTENT_SECTIONS = {
  settings: 'circle-settings',
  'signing-keys': 'circle-settings',
  governance: 'governance-settings',
  'governance-proposal-decision': 'governance-settings',
  modules: 'modules',
  composer: 'composer',
  'rate-limits': 'rate-limits',
  'media-moderate': 'social-media',
  structure: 'structure-manager',
  'profile-attributes': 'provider-profiles',
  'gossip-push': 'federation-gossip',
  'gossip-pull': 'federation-gossip',
  'peer-health-reset': 'federation-gossip',
  'provider-blind': 'provider-blind',
  'ops-metrics': 'metrics-retention',
  session: 'session-overrides',
};

export function resolveAdminIntentSection(intent = '') {
  const key = String(intent || '');
  if (INTENT_SECTIONS[key]) return INTENT_SECTIONS[key];
  if (key.startsWith('topic-')) return 'topic-gardener-review';
  return '';
}

export function adminFormAction(section) {
  return ADMIN_SECTION_IDS.includes(section) ? `/admin#${section}` : '/admin';
}

// A template placeholder per section (`adminNotice_rate_limits`), since the
// template engine only resolves word-character keys.
export function adminNoticeKey(section) {
  return `adminNotice_${String(section).replace(/-/g, '_')}`;
}

// What an admin handler did, returned beside its message. The tone follows the
// outcome, never the wording: a handler that says "Confirm the merge first" did
// not apply anything, however politely it is phrased.
export const ADMIN_OUTCOME = Object.freeze({
  APPLIED: 'applied',
  PARTIAL: 'partial',
  NOT_APPLIED: 'not_applied',
});

const OUTCOMES = new Set(Object.values(ADMIN_OUTCOME));

export function resolveAdminNoticeTone(outcome, { hasErrors = false } = {}) {
  return hasErrors || outcome !== ADMIN_OUTCOME.APPLIED ? 'warning' : 'success';
}

// Returns the per-section placeholders, plus `adminNotice` for a submission that
// maps to no known section (it renders under the page heading instead).
// A message without a known outcome is a handler bug; it reads as a warning
// rather than as a confirmation nobody can verify.
export function buildAdminSectionNotices({ flash, outcome, section, hasErrors = false } = {}) {
  const notices = { adminNotice: '' };
  for (const id of ADMIN_SECTION_IDS) notices[adminNoticeKey(id)] = '';
  if (!flash) return notices;
  const known = OUTCOMES.has(outcome) ? outcome : ADMIN_OUTCOME.NOT_APPLIED;
  const html = renderFormNotice(flash, { tone: resolveAdminNoticeTone(known, { hasErrors }) });
  if (ADMIN_SECTION_IDS.includes(section)) {
    notices[adminNoticeKey(section)] = html;
  } else {
    notices.adminNotice = html;
  }
  return notices;
}

export function renderAdminIndex() {
  const groups = ADMIN_SECTION_GROUPS.map((group) => `
      <li class="admin-index__group">
        <span class="admin-index__label">${escapeHtml(group.label)}</span>
        <ul class="admin-index__links">${group.sections
          .map(([id, label]) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(label)}</a></li>`)
          .join('')}</ul>
      </li>`).join('');
  return `<nav class="admin-index" aria-label="Admin settings"><ul class="admin-index__groups">${groups}</ul></nav>`;
}
