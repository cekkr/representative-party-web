import { getPerson } from '../../identity/person.js';
import { getEffectivePolicy } from '../../circle/policy.js';
import { isModuleEnabled, resolveModuleSettings } from '../../circle/modules.js';
import { sendHtml } from '../../../shared/utils/http.js';
import { renderPage } from '../../../interfaces/http/views/templates.js';
import { renderModuleDisabled } from '../../../interfaces/http/views/moduleGate.js';
import { resolvePersonHandle } from '../../../interfaces/http/views/actorLabel.js';
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
    return renderModuleDisabled({ res, state, wantsPartial, moduleKey: 'coordination' });
  }

  const person = getPerson(req, state);
  const effective = getEffectivePolicy(state);
  const modules = resolveModuleSettings(state);
  const selectedId = String(url?.searchParams?.get('case') || ORGANIZATION_TEMPLATE_CASES[0].id);
  const selected = ORGANIZATION_TEMPLATE_CASES.find((entry) => entry.id === selectedId) || ORGANIZATION_TEMPLATE_CASES[0];
  const canConfigure = person?.role === 'admin' || person?.role === 'moderator';
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
      pressureMapStatus: pressureAnalyticsEnabled ? 'Enabled' : 'Template preview',
      pressureMapStatusClass: pressureAnalyticsEnabled ? '' : 'ghost',
      pressureMapNote: pressureAnalyticsEnabled
        ? 'Aggregate organizational signals are enabled for this deployment.'
        : 'The pressure-dynamics module is off. This illustrative map does not analyze live staff activity.',
      configureAction: canConfigure
        ? '<a class="ghost" href="/admin#modules" data-partial>Configure modules</a>'
        : '<span class="muted small">Module activation is controlled by the organization administrator.</span>',
    },
    { wantsPartial, title: 'Coordination workspace', state },
  );
  return sendHtml(res, html);
}
