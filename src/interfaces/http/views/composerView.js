import { escapeHtml, sanitizeText } from '../../../shared/utils/text.js';

const SAFE_STYLE_KEYS = [
  'width',
  'height',
  'color',
  'background',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'textDecoration',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'padding',
  'margin',
  'border',
  'boxShadow',
  'gap',
  'gridTemplateColumns',
  'gridAutoFlow',
  'alignItems',
  'justifyContent',
  'display',
  'position',
  'zIndex',
  'left',
  'top',
];

export function resolveComposerText(overrides, key, fallback) {
  if (!key || !overrides || typeof overrides !== 'object') return fallback;
  const value = overrides[key];
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

export function resolveComposerTextEscaped(overrides, key, fallback) {
  return escapeHtml(resolveComposerText(overrides, key, fallback));
}

export function resolveComposerStyle(styleOverrides, key) {
  if (!key || !styleOverrides || typeof styleOverrides !== 'object') return '';
  const style = styleOverrides[key];
  if (!style || typeof style !== 'object') return '';
  const map = {
    fontSize: 'font-size',
    fontWeight: 'font-weight',
    fontStyle: 'font-style',
    textAlign: 'text-align',
    textDecoration: 'text-decoration',
    lineHeight: 'line-height',
    letterSpacing: 'letter-spacing',
    borderRadius: 'border-radius',
    boxShadow: 'box-shadow',
    gridTemplateColumns: 'grid-template-columns',
    gridAutoFlow: 'grid-auto-flow',
    alignItems: 'align-items',
    justifyContent: 'justify-content',
    zIndex: 'z-index',
  };
  const parts = [];
  for (const prop of SAFE_STYLE_KEYS) {
    const value = sanitizeCssValue(style[prop]);
    if (!value) continue;
    const cssProp = map[prop] || prop;
    parts.push(`${cssProp}: ${value};`);
  }
  return parts.join(' ');
}

function sanitizeCssValue(raw, maxLength = 180) {
  const cleaned = sanitizeText(raw || '', maxLength);
  if (!cleaned) return '';
  if (!/^[#()%,.\s0-9a-zA-Z-]+$/.test(cleaned)) return '';
  return cleaned;
}
