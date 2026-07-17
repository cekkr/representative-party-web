import { escapeHtml } from '../../../shared/utils/text.js';

/**
 * Shared "what applies to me here" panel.
 *
 * Lanes used to flatten four different kinds of information into one grey list
 * of `label: value` lines — identity facts, permission gates, lane guidance, and
 * live state all rendered identically. This separates them so the reader can
 * tell a rule from a fact from an explanation:
 *
 *   gates    what you may do right now, and the reason when you may not
 *   facts    stable term/value context (role, handle, stage)
 *   guidance prose about the lane; hidden in compact verbosity
 *
 * Gate tone: 'ok' | 'warning' | 'blocked'. Anything else renders neutral.
 */
export function renderContextPanel({ gates = [], facts = [], guidance = [] } = {}) {
  const sections = [renderGates(gates), renderFacts(facts), renderGuidance(guidance)].filter(Boolean);
  if (!sections.length) return '';
  return `<div class="context-panel">${sections.join('')}</div>`;
}

export function renderGates(gates = []) {
  const items = (gates || []).filter((gate) => gate && gate.label);
  if (!items.length) return '';
  const cards = items
    .map((gate) => {
      const tone = gateTone(gate);
      const reason = gate.reason
        ? `<p class="muted small context-gate__reason">${escapeHtml(String(gate.reason))}</p>`
        : '';
      return `
        <div class="context-gate is-${tone}">
          <div class="context-gate__row">
            <span class="context-gate__label">${escapeHtml(String(gate.label))}</span>
            <span class="pill ${pillTone(tone)}">${escapeHtml(String(gate.status || 'Unknown'))}</span>
          </div>
          ${reason}
        </div>
      `;
    })
    .join('');
  return `<div class="context-panel__gates">${cards}</div>`;
}

export function renderFacts(facts = []) {
  const items = (facts || []).filter((fact) => fact && fact.term && fact.value !== undefined && fact.value !== null);
  if (!items.length) return '';
  const rows = items
    .map(
      (fact) => `
        <div class="context-facts__row">
          <dt class="context-facts__term">${escapeHtml(String(fact.term))}</dt>
          <dd class="context-facts__value">${escapeHtml(String(fact.value))}</dd>
        </div>
      `,
    )
    .join('');
  return `<dl class="context-facts">${rows}</dl>`;
}

function renderGuidance(guidance = []) {
  const lines = (Array.isArray(guidance) ? guidance : [guidance]).filter(Boolean);
  if (!lines.length) return '';
  const paragraphs = lines.map((line) => `<p class="muted small">${escapeHtml(String(line))}</p>`).join('');
  return `<div class="context-panel__guidance is-verbose">${paragraphs}</div>`;
}

function gateTone(gate) {
  if (gate.tone) return gate.tone;
  if (gate.allowed === true) return 'ok';
  if (gate.allowed === false) return 'blocked';
  return 'neutral';
}

function pillTone(tone) {
  if (tone === 'blocked') return 'warning';
  if (tone === 'warning') return 'warning';
  if (tone === 'ok') return '';
  return 'ghost';
}
