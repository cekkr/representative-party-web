import { getPerson } from '../../identity/person.js';
import { getEffectivePolicy } from '../../circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { canAdministerProvider } from '../../identity/privileges.js';
import { logTransaction } from '../../transactions/registry.js';
import { persistOrganizationCases } from '../../../infra/persistence/storage.js';
import { sendHtml, sendRedirect } from '../../../shared/utils/http.js';
import { readRequestBody } from '../../../shared/utils/request.js';
import { sanitizeText } from '../../../shared/utils/text.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled } from '../../../interfaces/http/views/moduleGate.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
import { acknowledgeCase, canWorkWithCases, promoteCase } from '../cases.js';
import { buildCaseView } from '../caseView.js';
import {
  ORGANIZATION_LAYER_DEFINITIONS,
  ORGANIZATION_TEMPLATE_CASES,
  renderLayerPanels,
  renderLayerReadiness,
  renderLayerTabs,
  renderOperatingSteps,
  renderPressureInbox,
} from '../organizationTemplate.js';

export async function renderCoordination({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'coordination')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'coordination' });
  }

  const person = getPerson(req, state);
  const query = url.searchParams;
  if (query.get('view') === 'preview' || ORGANIZATION_TEMPLATE_CASES.some((entry) => entry.id === query.get('case'))) {
    return renderCoordinationPreview({ res, state, wantsPartial, person, query });
  }
  return renderLiveCases({ res, state, wantsPartial, person, query });
}

const caseWrites = new WeakMap();

export async function updateCoordination({ req, res, state, wantsPartial, url }) {
  if (!isModuleEnabled(state, 'coordination')) {
    return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'coordination' });
  }

  const body = await readRequestBody(req);
  const draft = {
    sourceId: sanitizeText(body.sourceId, 120),
    caseId: sanitizeText(body.caseId, 120),
    summary: sanitizeText(body.summary, 120),
    voiceType: sanitizeText(body.voiceType, 24),
    consequence: sanitizeText(body.consequence, 500),
    note: sanitizeText(body.note, 500),
    reviewAt: sanitizeText(body.reviewAt, 40),
  };

  // Resolve the source and any previous transition inside the write queue. Two
  // submissions for the same post must agree on the case and its acknowledgement.
  const write = (caseWrites.get(state) || Promise.resolve()).then(async () => {
    if (!isModuleEnabled(state, 'coordination')) return { disabled: true };
    const person = getPerson(req, state);
    if (!canWorkWithCases(state, person)) {
      return { status: person ? 403 : 401, message: 'Sign in with permission to post to use the case workspace.' };
    }
    const acknowledge = body.intent === 'acknowledge';
    if (!acknowledge && body.intent !== 'promote') {
      return { status: 400, message: 'Choose a case action.' };
    }
    const result = acknowledge ? acknowledgeCase(state, person, draft) : promoteCase(state, person, draft);
    if (!result.entry) return result;
    if (result.cases) await persistOrganizationCases(state, result.cases);

    const { entry } = result;
    const type = acknowledge ? 'organization_case_acknowledged' : 'organization_case_opened';
    await logTransaction(state, {
      id: `${type}:${entry.caseId}`,
      type,
      actorHash: acknowledge ? entry.acknowledgement.actorHash : entry.createdBy,
      createdAt: acknowledge ? entry.acknowledgement.at : entry.createdAt,
      payload: { caseId: entry.caseId, sourceMessageId: entry.sourceMessageId },
      providerLocal: true,
    });
    return result;
  });
  caseWrites.set(state, write.catch(() => {}));

  const result = await write;
  if (result.disabled) return renderModuleDisabled({ req, res, state, wantsPartial, moduleKey: 'coordination' });
  if (!result.entry) {
    return renderLiveCases({
      res, state, wantsPartial, person: getPerson(req, state), query: url.searchParams,
      draft, message: result.message, status: result.status,
    });
  }
  return sendRedirect(res, `/organization?case=${encodeURIComponent(result.entry.caseId)}`);
}

async function renderLiveCases({ res, state, wantsPartial, person, query, draft, message, status = 200 }) {
  const view = buildCaseView(state, { query, canWork: canWorkWithCases(state, person), draft, message });
  const html = await renderPage(
    'organization-cases',
    { ...view, person, personHandle: resolvePersonHandle(person), pageKey: 'coordination' },
    { wantsPartial, title: 'Coordination workspace', state },
  );
  return sendHtml(res, html, { 'Cache-Control': 'private, no-store' }, status);
}

async function renderCoordinationPreview({ res, state, wantsPartial, person, query }) {
  const effective = getEffectivePolicy(state);
  const modules = resolveModuleSettings(state);
  const selectedId = query.get('case');
  const selected = ORGANIZATION_TEMPLATE_CASES.find((entry) => entry.id === selectedId) || ORGANIZATION_TEMPLATE_CASES[0];
  const canConfigure = canAdministerProvider(person, state);
  const optionalLayers = ORGANIZATION_LAYER_DEFINITIONS.slice(1);
  const enabledOptionalLayers = optionalLayers.filter((layer) => modules[layer.moduleKey] !== false).length;
  const pressureAnalyticsEnabled = modules.pressureAnalytics !== false;

  const html = await renderPage(
    'coordination',
    {
      pageKey: 'coordination',
      person,
      personHandle: resolvePersonHandle(person),
      roleLabel: person?.role || 'guest',
      organizationName: effective.circleName || 'Organization',
      pressureInbox: renderPressureInbox(ORGANIZATION_TEMPLATE_CASES, selected.id),
      selectedTitle: selected.title,
      selectedStatus: selected.status,
      selectedDue: selected.due,
      selectedIntensity: selected.intensity,
      selectedIntensityTone: selected.intensityTone,
      selectedIntensityValue: selected.intensityValue,
      selectedDependency: selected.dependency,
      selectedVoiceType: selected.voiceType,
      selectedVisibility: selected.visibility,
      selectedPressureType: selected.pressureType,
      selectedPressureState: selected.pressureState,
      selectedTemperature: selected.temperature,
      selectedTrend: selected.trend,
      selectedScope: selected.scope,
      layerTabs: renderLayerTabs(modules),
      layerPanels: renderLayerPanels(selected, modules, { canConfigure }),
      layerReadiness: renderLayerReadiness(modules),
      operatingSteps: renderOperatingSteps(modules),
      enabledLayerCount: enabledOptionalLayers,
      optionalLayerCount: optionalLayers.length,
      pressureMapStatus: 'Template preview',
      pressureMapStatusClass: 'ghost',
      pressureMapNote: pressureAnalyticsEnabled
        ? 'The pressure-dynamics module is enabled. The values below are illustrative.'
        : 'The pressure-dynamics module is off. This illustrative map does not analyze live staff activity.',
      configureAction: canConfigure
        ? '<a class="ghost" href="/admin#modules" data-partial>Configure modules</a>'
        : '<span class="muted small">Module activation is controlled by the organization administrator.</span>',
    },
    { wantsPartial, title: 'Coordination workspace preview', state },
  );
  return sendHtml(res, html);
}
