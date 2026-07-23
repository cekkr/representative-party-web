// Shared vocabulary and normalization for the member-facing "Appearance" and
// "Sections" controls. Both the server (profile controller, layout builder) and the
// browser (app.js) must agree on the allowed accent/density/theme keys and on how the
// per-page hidden-section map is shaped, so that vocabulary lives here once.
//
// The accent keys map to a --primary-h hue in app.css via `:root[data-ui-accent="…"]`
// rules (on <html>, not <body> — the derived token layer is declared on :root and
// resolves its nested var() there); the server only validates the key, never a raw
// hue, so a member can never inject an arbitrary value.

import { parseBoolean } from '../../../shared/utils/parse.js';

export const ACCENT_KEYS = ['violet', 'blue', 'teal', 'green', 'rose', 'amber'];
export const DEFAULT_ACCENT = 'violet';

export const DENSITY_KEYS = ['comfortable', 'compact', 'relaxed'];
export const DEFAULT_DENSITY = 'comfortable';

// `system` is stored and rendered verbatim; app.css resolves it through a
// prefers-color-scheme media query rather than JavaScript, so the member's OS setting
// applies on the first paint and with JS disabled. The deployment stays dark-first.
export const THEME_KEYS = ['dark', 'light', 'system'];
export const DEFAULT_THEME = 'dark';

// The browser needs the same vocabulary to validate what it stores in localStorage.
// Rather than keeping a hand-maintained copy in app.js (which silently drifted when a
// key was added here), the layout ships this payload on the body and app.js reads it,
// so a key added above reaches the client with no second edit.
export function interfaceVocabulary() {
  return {
    accents: [...ACCENT_KEYS],
    densities: [...DENSITY_KEYS],
    themes: [...THEME_KEYS],
    defaults: { accent: DEFAULT_ACCENT, density: DEFAULT_DENSITY, theme: DEFAULT_THEME },
  };
}

const MAX_HIDDEN_PAGES = 60;
const MAX_HIDDEN_PER_PAGE = 40;
const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export function sanitizeSectionKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return KEY_PATTERN.test(trimmed) ? trimmed : '';
}

function pickFromSet(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function normalizeHiddenSections(source) {
  let raw = source;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  let pageCount = 0;
  for (const [pageKey, list] of Object.entries(raw)) {
    if (pageCount >= MAX_HIDDEN_PAGES) break;
    const cleanPage = sanitizeSectionKey(pageKey);
    if (!cleanPage || !Array.isArray(list)) continue;
    const keys = [];
    for (const entry of list) {
      if (keys.length >= MAX_HIDDEN_PER_PAGE) break;
      const cleanKey = sanitizeSectionKey(entry);
      if (cleanKey && !keys.includes(cleanKey)) keys.push(cleanKey);
    }
    if (keys.length) {
      out[cleanPage] = keys;
      pageCount += 1;
    }
  }
  return out;
}

export function normalizeInterfaceSettings(source = {}) {
  const payload = source && typeof source === 'object' ? source : {};
  return {
    largeText: parseBoolean(payload.uiLargeText ?? payload.largeText, false),
    reducedMotion: parseBoolean(payload.uiReducedMotion ?? payload.reducedMotion, false),
    compactNav: parseBoolean(payload.uiCompactNav ?? payload.compactNav, false),
    keepComposerOpen: parseBoolean(payload.uiKeepComposerOpen ?? payload.keepComposerOpen, false),
    partialNavigation: parseBoolean(payload.uiPartialNavigation ?? payload.partialNavigation, true),
    accent: pickFromSet(payload.uiAccent ?? payload.accent, ACCENT_KEYS, DEFAULT_ACCENT),
    density: pickFromSet(payload.uiDensity ?? payload.density, DENSITY_KEYS, DEFAULT_DENSITY),
    theme: pickFromSet(payload.uiTheme ?? payload.theme, THEME_KEYS, DEFAULT_THEME),
    hiddenSections: normalizeHiddenSections(payload.uiHiddenSections ?? payload.hiddenSections),
  };
}
