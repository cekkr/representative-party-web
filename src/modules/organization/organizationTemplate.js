import { escapeHtml } from '../../shared/utils/text.js';

export const ORGANIZATION_LAYER_DEFINITIONS = [
  {
    key: 'communication',
    moduleKey: 'coordination',
    label: 'Communication',
    shortLabel: 'Inbox',
    description: 'Keep the source message, reply path, and shared understanding together.',
  },
  {
    key: 'protection',
    moduleKey: 'protectedVoice',
    label: 'Protection',
    shortLabel: 'Voice',
    description: 'Let people choose the least exposing identity mode that still permits a safe response.',
  },
  {
    key: 'responsibilities',
    moduleKey: 'responsibilities',
    label: 'Responsibilities',
    shortLabel: 'Owners',
    description: 'Separate outcome ownership, action commitments, consultation, and notification.',
  },
  {
    key: 'hierarchies',
    moduleKey: 'hierarchies',
    label: 'Structure',
    shortLabel: 'Escalation',
    description: 'Show the smallest contextual escalation route needed for this pressure.',
  },
  {
    key: 'authority',
    moduleKey: 'authority',
    label: 'Authority',
    shortLabel: 'Powers',
    description: 'Make decision rights explicit, scoped, sourced, and time-bound.',
  },
  {
    key: 'funds',
    moduleKey: 'funds',
    label: 'Funds',
    shortLabel: 'Resources',
    description: 'Connect exposure, ceilings, approvals, evidence, and reconciliation.',
  },
  {
    key: 'sectors',
    moduleKey: 'sectors',
    label: 'Sectors',
    shortLabel: 'Domains',
    description: 'View one case through multiple operating domains without duplicating it.',
  },
  {
    key: 'mediation',
    moduleKey: 'mediation',
    label: 'Mediation',
    shortLabel: 'Pacification',
    description: 'Acknowledge harm, review without blame, mediate, and escalate without suppressing accountability.',
  },
  {
    key: 'pressure',
    moduleKey: 'pressureAnalytics',
    label: 'Pressure',
    shortLabel: 'Dynamics',
    description: 'Read volume, velocity, persistence, spread, and operating state at aggregate level.',
  },
  {
    key: 'impact',
    moduleKey: 'impactTracking',
    label: 'Impact',
    shortLabel: 'Learning',
    description: 'Track whether an intervention relieved pressure, moved it elsewhere, or created useful learning.',
  },
];

export const ORGANIZATION_TEMPLATE_CASES = [
  {
    id: 'night-medication-flow',
    title: 'Night medication deliveries miss safety windows',
    sender: 'Night Nursing',
    from: 'night-nursing@care.example',
    subject: 'Recurring delay between pharmacy release and ward delivery',
    received: '09:14',
    due: 'Today · 16:00',
    status: 'Needs cross-unit review',
    intensity: 'High',
    intensityTone: 'high',
    intensityValue: 78,
    voiceType: 'Fundamental need',
    visibility: 'Role-visible',
    sourceChannel: 'Email',
    pressureType: 'Oscillating',
    pressureState: 'Crystallized',
    temperature: 'Concerned',
    trend: 'Rising across night shifts',
    scope: 'Nursing · Pharmacy · Logistics',
    request: 'Review and change the night medication delivery sequence before the next rota.',
    consequence: 'Repeated 35-minute delays compress safety checks and move risk onto the ward team.',
    dependency: 'Pharmacy release timing, porter capacity, and ward hand-off data must be seen together.',
    nextMove: 'Validate the pattern with three shifts, then run a bounded delivery-sequence pilot.',
    owner: 'Nora · Pharmacy operations',
    actionOwner: 'Cross-shift pilot group',
    consulted: 'Night nursing · Logistics · Patient safety',
    informed: 'Ward and pharmacy leads',
    emailBody:
      'For the fourth night this month, ward deliveries arrived more than 30 minutes after pharmacy release. The checks still happened, but the available time was compressed. Could we review the sequence with pharmacy and logistics before the next rota?',
    replyDraft:
      'Thank you. We are validating the pattern across recent night shifts and have asked pharmacy and logistics to join a short review. We will return by 16:00 with a pilot owner, boundary, and next update.',
    hierarchy: [
      ['Case steward', 'Nora · Pharmacy operations', 'Keeps the signal visible and closes the reply loop.'],
      ['Cross-unit review', 'Night nursing + Logistics', 'Supplies shift evidence and proposes a safe pilot.'],
      ['Safety escalation', 'Clinical risk lead', 'Acts only if the pattern presents immediate patient risk.'],
    ],
    formalFlow: 'Nursing → ward lead → clinical director → pharmacy director',
    actualFlow: 'Night nurse ↔ pharmacy coordinator ↔ porter lead',
    authority: [
      ['Raise', 'Any staff member', 'May surface a need without management approval.'],
      ['Propose', 'Cross-shift pilot group', 'May frame a bounded sequence change.'],
      ['Approve', 'Pharmacy operations lead', 'For a two-week pilot inside existing safety policy.'],
      ['Stop', 'Patient safety lead', 'If monitoring shows new clinical risk.'],
    ],
    amount: '€18,000 pilot capacity',
    budget: 'Operations improvement',
    ceiling: '€20,000 without board review',
    fundsState: 'Options visible · no allocation yet',
    sectors: [
      ['Nursing', 'Signal origin', 'Describes the safety compression at hand-off.'],
      ['Pharmacy', 'Flow owner', 'Controls release timing and verification.'],
      ['Logistics', 'Dependency', 'Provides delivery capacity and route data.'],
      ['Patient safety', 'Safeguard', 'Defines stop conditions and measures.'],
    ],
    impactBaseline: '4 delayed night deliveries in 30 days · median 35 minutes',
    impactTarget: 'Median delivery under 15 minutes without missed checks',
    impactMeasure: 'Release-to-ward time, check completion, staff load',
  },
  {
    id: 'rural-follow-up',
    title: 'Pilot a rural follow-up call window',
    sender: 'Junior doctor · Outpatient',
    from: 'outpatient-team@care.example',
    subject: 'Pattern: rural patients miss follow-up appointments',
    received: 'Yesterday',
    due: 'Friday · review',
    status: 'Seeking peer validation',
    intensity: 'Medium',
    intensityTone: 'medium',
    intensityValue: 56,
    voiceType: 'Advice & innovation',
    visibility: 'Fully attributed',
    sourceChannel: 'Email',
    pressureType: 'Chronic',
    pressureState: 'Diffuse',
    temperature: 'Professional',
    trend: 'Stable but unresolved',
    scope: 'Outpatient · Social care · Scheduling',
    request: 'Test a call window before rural follow-up appointments.',
    consequence: 'Repeated non-attendance leaves a dispersed access problem invisible and untreated.',
    dependency: 'The cause may be transport, timing, phone access, or a combination.',
    nextMove: 'Cluster similar cases and invite social care and scheduling to validate the cause.',
    owner: 'Unassigned pending validation',
    actionOwner: 'Outpatient discovery pair',
    consulted: 'Social care · Scheduling · Patient liaison',
    informed: 'Outpatient team',
    emailBody:
      'We keep seeing rural patients miss follow-up appointments, but the record only says “did not attend.” Could we test a short call window and ask whether transport, timing, or connectivity is the obstacle?',
    replyDraft:
      'The pattern is now visible as an advice case. We are checking for similar observations and will invite social care and scheduling before proposing a pilot.',
    hierarchy: [
      ['Signal steward', 'Outpatient discovery pair', 'Collects examples without changing care policy.'],
      ['Cross-service review', 'Social care + Scheduling', 'Tests likely causes and feasible support.'],
      ['Pilot sponsor', 'Outpatient lead', 'Approves a limited experiment if evidence supports it.'],
    ],
    formalFlow: 'Doctor → outpatient lead → service director',
    actualFlow: 'Doctor ↔ scheduler ↔ social worker ↔ patient liaison',
    authority: [
      ['Raise', 'Any staff member', 'May publish an observation or advice.'],
      ['Validate', 'Affected services', 'Confirm whether the pattern is shared.'],
      ['Approve', 'Outpatient lead', 'May authorize a small pilot.'],
      ['Participate', 'Patients by consent', 'May explain access barriers without affecting care.'],
    ],
    amount: 'Staff time only',
    budget: 'Service improvement time',
    ceiling: '4 hours per week',
    fundsState: 'Capacity consultation',
    sectors: [
      ['Outpatient', 'Signal origin', 'Sees the missed follow-up pattern.'],
      ['Social care', 'Context', 'Understands transport and home constraints.'],
      ['Scheduling', 'Process', 'Can test time-window alternatives.'],
      ['Patient liaison', 'Protection', 'Keeps patient participation voluntary.'],
    ],
    impactBaseline: '18 missed rural follow-ups in 90 days',
    impactTarget: 'Identify causes and reduce avoidable misses by 20%',
    impactMeasure: 'Contact rate, attendance, staff time, patient feedback',
  },
  {
    id: 'equipment-allocation',
    title: 'Consult on the equipment upgrade envelope',
    sender: 'Department administration',
    from: 'department-office@care.example',
    subject: '€50,000 available: compare five upgrade options',
    received: 'Monday',
    due: 'Next Tuesday · input closes',
    status: 'Open consultation',
    intensity: 'Medium',
    intensityTone: 'medium',
    intensityValue: 48,
    voiceType: 'Resource consultation',
    visibility: 'Department-visible',
    sourceChannel: 'Email',
    pressureType: 'Acute',
    pressureState: 'Flowing',
    temperature: 'Professional',
    trend: 'Decision window open',
    scope: 'Clinical teams · Technical services · Finance',
    request: 'Explain the operational trade-offs among five equipment upgrades.',
    consequence: 'A technically valid purchase could still miss the most valuable frontline constraint.',
    dependency: 'Utilization, safety, maintenance, training, and full lifecycle cost differ.',
    nextMove: 'Publish comparable evidence and gather structured input before the accountable decision.',
    owner: 'Department head',
    actionOwner: 'Procurement analyst',
    consulted: 'Daily users · Technical services · Finance',
    informed: 'All department staff',
    emailBody:
      'The department has €50,000 for equipment upgrades. Five options are viable. Please add operational consequences, maintenance needs, and patient impact before the decision meeting next Tuesday.',
    replyDraft:
      'The five options and their current evidence are now visible. Input will inform the accountable decision; this consultation does not transfer the department head’s responsibility.',
    hierarchy: [
      ['Consultation steward', 'Procurement analyst', 'Normalizes evidence across options.'],
      ['Expert review', 'Technical services', 'Validates safety and lifecycle assumptions.'],
      ['Accountable decision', 'Department head', 'Chooses and publishes the rationale.'],
    ],
    formalFlow: 'Finance → department head → procurement',
    actualFlow: 'Daily users ↔ technical services ↔ procurement analyst',
    authority: [
      ['Advise', 'Department staff', 'May describe implications and rank concerns.'],
      ['Validate', 'Technical services', 'Confirms safety and maintenance claims.'],
      ['Decide', 'Department head', 'Remains accountable for the final allocation.'],
      ['Execute', 'Procurement', 'Only after a recorded decision and budget check.'],
    ],
    amount: '€50,000 available',
    budget: 'Department equipment upgrades',
    ceiling: 'Fixed annual envelope',
    fundsState: 'Transparent consultation',
    sectors: [
      ['Clinical teams', 'Daily use', 'Describe workflow and patient impact.'],
      ['Technical services', 'Expert review', 'Assesses reliability and maintenance.'],
      ['Finance', 'Constraint', 'Makes the real envelope visible.'],
      ['Procurement', 'Execution', 'Runs a compliant purchase after decision.'],
    ],
    impactBaseline: 'Five competing options · no common evidence format',
    impactTarget: 'Decision rationale understood across affected roles',
    impactMeasure: 'Utilization, downtime, training, patient impact, total cost',
  },
  {
    id: 'handover-dispute',
    title: 'Resolve a recurring handover dispute',
    sender: 'Two care teams',
    from: 'protected-relay@care.example',
    subject: 'Conflicting safety and throughput expectations at handover',
    received: 'Monday',
    due: 'No public deadline',
    status: 'Protected acknowledgement',
    intensity: 'High',
    intensityTone: 'high',
    intensityValue: 73,
    voiceType: 'Constructive concern',
    visibility: 'Protected relay',
    sourceChannel: 'Protected intake',
    pressureType: 'Cascade',
    pressureState: 'Crystallized',
    temperature: 'Warm',
    trend: 'Spreading across shifts',
    scope: 'Two teams · shared handover',
    request: 'Create a safe mediation path for incompatible handover expectations.',
    consequence: 'The conflict is producing workarounds, blame avoidance, and missed information.',
    dependency: 'Both teams hold valid safety and throughput concerns and fear retaliation.',
    nextMove: 'Acknowledge privately, freeze public attribution, and appoint a neutral peer mediator.',
    owner: 'Independent case steward',
    actionOwner: 'Peer mediation pair',
    consulted: 'Patient safety · Staff support',
    informed: 'Only participants until disclosure is agreed',
    emailBody:
      'The current handover expectations cannot be met together during peak shifts. Attempts to raise this have become personal. We need a protected review focused on the system, not on blame.',
    replyDraft:
      'Your concern has been acknowledged through the protected channel. Attribution remains restricted. A neutral mediator will contact both sides separately before any shared review.',
    hierarchy: [
      ['Protected steward', 'Independent case manager', 'Controls disclosure and acknowledgement.'],
      ['Peer mediation', 'Two trained cross-role mediators', 'Surfaces interests and testable agreements.'],
      ['Formal escalation', 'Patient safety office', 'Acts if mediation cannot contain a safety risk.'],
    ],
    formalFlow: 'Team leads → department heads → safety office',
    actualFlow: 'Shift staff ↔ unofficial workarounds ↔ delayed escalation',
    authority: [
      ['Protect', 'Case steward', 'Limits identity disclosure to the agreed scope.'],
      ['Mediate', 'Peer mediators', 'Facilitate but do not adjudicate.'],
      ['Agree', 'Participating teams', 'May adopt a bounded handover experiment.'],
      ['Escalate', 'Safety office', 'Acts on unresolved material risk.'],
    ],
    amount: 'No compensation decision',
    budget: 'Staff support and mediation',
    ceiling: 'Independent review if needed',
    fundsState: 'Separate from case merits',
    sectors: [
      ['Team A', 'Participant', 'Presents safety constraints.'],
      ['Team B', 'Participant', 'Presents throughput constraints.'],
      ['Mediation', 'Protected space', 'Keeps the conflict constructive.'],
      ['Patient safety', 'Escalation', 'Receives only necessary risk information.'],
    ],
    impactBaseline: 'Repeated workarounds and unresolved handover friction',
    impactTarget: 'One shared handover protocol with safe exception handling',
    impactMeasure: 'Missed items, delay, reported safety, participant trust',
  },
];

export function renderPressureInbox(cases, selectedId) {
  return cases
    .map((entry) => {
      const active = entry.id === selectedId;
      return `
        <a
          class="pressure-case${active ? ' is-active' : ''}"
          href="/organization?view=preview&amp;case=${encodeURIComponent(entry.id)}#pressure-focus"
          data-partial
          ${active ? 'aria-current="true"' : ''}
        >
          <span class="pressure-case__topline">
            <span class="pressure-case__sender">${escapeHtml(entry.sender)}</span>
            <span class="muted tiny">${escapeHtml(entry.received)}</span>
          </span>
          <strong>${escapeHtml(entry.title)}</strong>
          <span class="pressure-case__preview">${escapeHtml(entry.subject)}</span>
          <span class="pressure-case__meta">
            <span class="pressure-case__classification">${escapeHtml(entry.voiceType)}</span>
            <span class="pressure-intensity pressure-intensity--${escapeHtml(entry.intensityTone)}">${escapeHtml(entry.intensity)}</span>
            <span class="muted tiny">${escapeHtml(entry.due)}</span>
          </span>
        </a>
      `;
    })
    .join('\n');
}

export function renderLayerTabs(modules = {}) {
  return ORGANIZATION_LAYER_DEFINITIONS.map((layer, index) => {
    const enabled = modules[layer.moduleKey] !== false;
    const status = layer.key === 'communication' ? 'Core' : enabled ? 'On' : 'Preview';
    return `
      <button
        class="pressure-layer-tab${index === 0 ? ' is-active' : ''}"
        type="button"
        role="tab"
        id="pressure-layer-tab-${escapeHtml(layer.key)}"
        aria-controls="pressure-layer-${escapeHtml(layer.key)}"
        aria-selected="${index === 0 ? 'true' : 'false'}"
        data-pressure-layer-target="${escapeHtml(layer.key)}"
      >
        <span>${escapeHtml(layer.label)}</span>
        <span class="pressure-layer-tab__status${enabled ? '' : ' is-preview'}">${status}</span>
      </button>
    `;
  }).join('\n');
}

export function renderLayerPanels(selected, modules = {}, { canConfigure = false } = {}) {
  return ORGANIZATION_LAYER_DEFINITIONS.map((layer, index) => {
    const enabled = modules[layer.moduleKey] !== false;
    const previewNote = enabled || layer.key === 'communication'
      ? ''
      : renderLayerPreviewNote(layer, { canConfigure });
    const content = renderLayerContent(layer.key, selected);
    return `
      <section
        class="pressure-layer-panel${enabled ? '' : ' is-preview'}"
        id="pressure-layer-${escapeHtml(layer.key)}"
        role="tabpanel"
        aria-labelledby="pressure-layer-tab-${escapeHtml(layer.key)}"
        data-pressure-layer-panel="${escapeHtml(layer.key)}"
        ${index === 0 ? '' : 'hidden'}
      >
        <div class="pressure-layer-panel__heading">
          <div>
            <p class="eyebrow">${escapeHtml(layer.shortLabel)} layer</p>
            <h3>${escapeHtml(layer.label)}</h3>
          </div>
          <span class="pill ghost">Template preview</span>
        </div>
        <p class="muted small">${escapeHtml(layer.description)}</p>
        ${previewNote}
        ${content}
      </section>
    `;
  }).join('\n');
}

export function renderLayerReadiness(modules = {}) {
  return ORGANIZATION_LAYER_DEFINITIONS.map((layer) => {
    const enabled = modules[layer.moduleKey] !== false;
    return `
      <li>
        <span>${escapeHtml(layer.label)}</span>
        <span class="pressure-readiness__state${enabled ? ' is-on' : ''}">${enabled ? 'On' : 'Available'}</span>
      </li>
    `;
  }).join('\n');
}

export function renderOperatingSteps(modules = {}) {
  return ORGANIZATION_LAYER_DEFINITIONS.map((layer, index) => {
    const enabled = modules[layer.moduleKey] !== false;
    return `
      <li class="operating-step${enabled ? ' is-on' : ''}">
        <span class="operating-step__number">${index + 1}</span>
        <span>
          <strong>${escapeHtml(layer.label)}</strong>
          <small>${escapeHtml(layer.description)}</small>
        </span>
      </li>
    `;
  }).join('\n');
}

function renderLayerPreviewNote(layer, { canConfigure }) {
  const action = canConfigure
    ? '<a class="ghost tiny" href="/admin#modules" data-partial>Open module settings</a>'
    : '<span class="muted tiny">An administrator can enable this layer independently.</span>';
  return `
    <div class="pressure-preview-note">
      <span>This layer is off. The example below documents the intended interface without activating its workflow.</span>
      ${action}
    </div>
  `;
}

function renderLayerContent(key, selected) {
  if (key === 'communication') return renderCommunicationLayer(selected);
  if (key === 'protection') return renderProtectionLayer(selected);
  if (key === 'responsibilities') return renderResponsibilitiesLayer(selected);
  if (key === 'hierarchies') return renderHierarchyLayer(selected);
  if (key === 'authority') return renderAuthorityLayer(selected);
  if (key === 'funds') return renderFundsLayer(selected);
  if (key === 'sectors') return renderSectorsLayer(selected);
  if (key === 'mediation') return renderMediationLayer(selected);
  if (key === 'pressure') return renderPressureLayer(selected);
  if (key === 'impact') return renderImpactLayer(selected);
  return '';
}

function renderCommunicationLayer(selected) {
  return `
    <div class="pressure-question-grid">
      ${renderQuestion('What is being asked?', selected.request)}
      ${renderQuestion('What creates pressure?', selected.consequence)}
      ${renderQuestion('What is the next safe move?', selected.nextMove)}
    </div>
    <article class="pressure-email">
      <header class="pressure-email__header">
        <div>
          <span class="muted tiny">From</span>
          <strong>${escapeHtml(selected.sender)} &lt;${escapeHtml(selected.from)}&gt;</strong>
        </div>
        <div class="discussion__meta">
          <span class="pill ghost">${escapeHtml(selected.sourceChannel)} · source record</span>
          <span class="pill ghost">${escapeHtml(selected.visibility)}</span>
        </div>
      </header>
      <p class="pressure-email__subject">${escapeHtml(selected.subject)}</p>
      <p>${escapeHtml(selected.emailBody)}</p>
    </article>
    <details class="pressure-reply">
      <summary>Draft a bounded reply</summary>
      <div class="stack">
        <label class="field">
          <span>Reply draft</span>
          <textarea rows="4" aria-label="Illustrative reply draft">${escapeHtml(selected.replyDraft)}</textarea>
        </label>
        <p class="muted tiny">Template only: no message is sent and no address is persisted by this screen.</p>
      </div>
    </details>
  `;
}

function renderProtectionLayer(selected) {
  const levels = [
    ['Protected', 'Random case identity; replies pass through a steward or protected relay.'],
    ['Department-visible', 'The operating unit is visible, while the individual remains shielded.'],
    ['Role-visible', 'The professional role is visible without exposing the person by default.'],
    ['Fully attributed', 'The contributor chooses a public professional identity and direct dialogue.'],
  ];
  return `
    <div class="pressure-protection-grid">
      ${levels.map(([label, note]) => {
        const active = selected.visibility.toLowerCase().includes(label.toLowerCase().split('-')[0]);
        return `
          <article class="${active ? 'is-active' : ''}">
            <div><strong>${escapeHtml(label)}</strong>${active ? '<span class="pill">Current case</span>' : ''}</div>
            <p class="muted small">${escapeHtml(note)}</p>
          </article>
        `;
      }).join('\n')}
    </div>
    <div class="pressure-safeguards">
      <span>Metadata minimization</span>
      <span>Disclosure by consent</span>
      <span>Retaliation reporting</span>
      <span>Human moderation</span>
    </div>
    <p class="pressure-principle">Email is inherently attributed. A protected intake must use a separate, audited channel and must never promise anonymity that its metadata cannot provide.</p>
  `;
}

function renderResponsibilitiesLayer(selected) {
  const rows = [
    ['Outcome owner', selected.owner, 'Accountable for closing the pressure, not for doing every action.'],
    ['Action owner', selected.actionOwner, 'Makes the next explicit commitment.'],
    ['Consulted', selected.consulted, 'Provides input before a decision or commitment.'],
    ['Informed', selected.informed, 'Receives state changes without becoming an approver.'],
  ];
  return renderDefinitionRows(rows, 'pressure-responsibility-grid');
}

function renderHierarchyLayer(selected) {
  return `
    <div class="pressure-flow-compare">
      <article><span class="muted tiny">Formal reporting view</span><strong>${escapeHtml(selected.formalFlow)}</strong></article>
      <article><span class="muted tiny">Observed working flow</span><strong>${escapeHtml(selected.actualFlow)}</strong></article>
    </div>
    <ol class="pressure-escalation">
      ${selected.hierarchy.map(([role, actor, scope], index) => `
        <li>
          <span class="pressure-escalation__index">${index + 1}</span>
          <span><small>${escapeHtml(role)}</small><strong>${escapeHtml(actor)}</strong><em>${escapeHtml(scope)}</em></span>
        </li>
      `).join('\n')}
    </ol>
    <p class="pressure-principle">The path belongs to this context. It does not create a permanent rank or silently transfer decision rights.</p>
  `;
}

function renderAuthorityLayer(selected) {
  return `
    <div class="pressure-authority-grid">
      ${selected.authority.map(([right, actor, scope]) => `
        <article>
          <span class="pressure-authority__right">${escapeHtml(right)}</span>
          <strong>${escapeHtml(actor)}</strong>
          <p class="muted small">${escapeHtml(scope)}</p>
        </article>
      `).join('\n')}
    </div>
    <p class="pressure-principle">Every power needs a source, scope, start, and expiry. A title alone is not an authorization.</p>
  `;
}

function renderFundsLayer(selected) {
  return `
    <div class="pressure-funds-summary">
      ${renderMetric('Exposure', selected.amount)}
      ${renderMetric('Resource envelope', selected.budget)}
      ${renderMetric('Approval ceiling', selected.ceiling)}
      ${renderMetric('Control state', selected.fundsState)}
    </div>
    <ol class="pressure-checklist">
      <li><span>1</span><p><strong>Shared constraint</strong><small>Expose the real envelope and lifecycle costs without expecting everyone to become an accountant.</small></p></li>
      <li><span>2</span><p><strong>Structured consultation</strong><small>Let daily users and experts explain consequences that the budget holder may not see.</small></p></li>
      <li><span>3</span><p><strong>Accountable decision</strong><small>Record who decided, under which power, with what rationale and ceiling.</small></p></li>
      <li><span>4</span><p><strong>Execution and reconciliation</strong><small>Keep spending separate from approval, then compare the outcome with the promise.</small></p></li>
    </ol>
  `;
}

function renderSectorsLayer(selected) {
  return `
    <div class="pressure-sector-grid">
      ${selected.sectors.map(([sector, relation, note]) => `
        <article>
          <div><strong>${escapeHtml(sector)}</strong><span class="pill ghost">${escapeHtml(relation)}</span></div>
          <p class="muted small">${escapeHtml(note)}</p>
        </article>
      `).join('\n')}
    </div>
    <p class="pressure-principle">Sectors are views over the same case. They must not fork ownership, evidence, or status into competing copies.</p>
  `;
}

function renderMediationLayer(selected) {
  const steps = [
    ['Acknowledge', 'Confirm receipt, safety, visibility, and a named case steward.'],
    ['Review', 'Separate system conditions, evidence, interests, and immediate risks from blame.'],
    ['Dialogue', 'Use a neutral human mediator; assistance may frame but never adjudicate.'],
    ['Agreement', 'Record a bounded action, owner, review date, and participant consent.'],
    ['Escalate', 'Use formal, legal, or safety channels when mediation cannot contain material risk.'],
  ];
  return `
    <div class="pressure-mediation-heading">
      <span class="pill">${escapeHtml(selected.voiceType)}</span>
      <span class="pill ghost">${escapeHtml(selected.visibility)}</span>
      <span class="pill ghost">${escapeHtml(selected.temperature)} temperature</span>
    </div>
    <ol class="pressure-mediation-path">
      ${steps.map(([label, note], index) => `
        <li><span>${index + 1}</span><p><strong>${escapeHtml(label)}</strong><small>${escapeHtml(note)}</small></p></li>
      `).join('\n')}
    </ol>
    <p class="pressure-principle">Pacification is not suppression, forced compromise, or immunity from accountability. It is a protected path toward explanation, repair, and proportionate escalation.</p>
  `;
}

function renderPressureLayer(selected) {
  return `
    <div class="pressure-dynamics-summary">
      ${renderMetric('Type', selected.pressureType)}
      ${renderMetric('Operating state', selected.pressureState)}
      ${renderMetric('Temperature', selected.temperature)}
      ${renderMetric('Trend', selected.trend)}
    </div>
    <div class="pressure-dynamics-grid">
      <article><span>Volume</span><strong>How many corroborating signals?</strong><p class="muted small">Counts distinct, permission-compatible signals rather than popularity.</p></article>
      <article><span>Velocity</span><strong>How quickly is the pattern changing?</strong><p class="muted small">Compares the current window with an appropriate baseline.</p></article>
      <article><span>Persistence</span><strong>How long has it remained unresolved?</strong><p class="muted small">Highlights repeated or crystallized pressure without blaming the reporting unit.</p></article>
      <article><span>Spread</span><strong>Where is pressure propagating?</strong><p class="muted small">Maps dependencies and displacement across sectors or shifts.</p></article>
    </div>
    <p class="pressure-principle">Pressure analytics describe systems and aggregates. They must not become sentiment-policing, a worker score, or an automatic trigger for punitive action.</p>
  `;
}

function renderImpactLayer(selected) {
  const rows = [
    ['Baseline', selected.impactBaseline, 'What is known before intervention.'],
    ['Target', selected.impactTarget, 'What relief or learning would count as useful.'],
    ['Measures', selected.impactMeasure, 'A small mixed set of outcome and human-load signals.'],
    ['Review', 'Pilot close + 30-day recurrence check', 'Checks whether pressure fell, returned, or moved elsewhere.'],
  ];
  return `
    ${renderDefinitionRows(rows, 'pressure-impact-grid')}
    <div class="pressure-impact-timeline">
      <span class="is-complete">Signal</span><span>Baseline</span><span>Intervention</span><span>Review</span><span>Learning</span>
    </div>
    <p class="pressure-principle">A closed case is not automatically a solved problem. Impact tracking keeps the explanation, observed effect, and reusable learning together.</p>
  `;
}

function renderQuestion(label, value) {
  return `<article><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></article>`;
}

function renderMetric(label, value) {
  return `<article><span class="muted tiny">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderDefinitionRows(rows, className) {
  return `
    <div class="${className}">
      ${rows.map(([label, value, note]) => `
        <article>
          <span class="muted tiny">${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <p class="muted small">${escapeHtml(note)}</p>
        </article>
      `).join('\n')}
    </div>
  `;
}
