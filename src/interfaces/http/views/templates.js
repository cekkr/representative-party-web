import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_PAGE_TITLE, PATHS } from '../../../config.js';
import { escapeHtml } from '../../../shared/utils/text.js';
import { normalizeVerbosityMode } from '../../../shared/utils/parse.js';
import { getActorLabels } from './actorLabel.js';
import { resolveComposerStyle, resolveComposerTextEscaped } from './composerView.js';
import { renderNav } from './navigation.js';
import { deriveStatusMeta, renderStatusStrip } from './status.js';

const templateCache = new Map();
const MODULES_ROOT = join(PATHS.ROOT, 'modules');
const TEMPLATE_MODULES = {
  layout: 'core',
  error: 'core',
  'module-disabled': 'core',
  'admin-required': 'core',
  home: 'home',
  'auth-eudi': 'auth',
  'verification-complete': 'auth',
  discussion: 'discussion',
  forum: 'forum',
  governance: 'governance',
  petitions: 'petitions',
  groups: 'groups',
  delegation: 'delegation',
  'delegate-profile': 'delegates',
  'delegate-directory': 'delegates',
  notifications: 'notifications',
  profile: 'profile',
  social: 'social',
  admin: 'admin',
  coordination: 'organization',
};

export async function renderPage(templateName, data = {}, { wantsPartial = false, title = DEFAULT_PAGE_TITLE, state } = {}) {
  const bodyTemplate = await loadTemplate(templateName);
  const actorLabels = getActorLabels(state);
  const body = applyTemplate(bodyTemplate, { ...actorLabels, ...data });
  const statusStrip = data.statusStrip !== undefined ? data.statusStrip : renderStatusStrip(deriveStatusMeta(state));
  const pageKey = data.pageKey || templateName;
  const composerSettings = state?.settings?.composer || {};
  const pages = composerSettings.pages && typeof composerSettings.pages === 'object' ? composerSettings.pages : {};
  const pageOverrides = pages[pageKey] && typeof pages[pageKey] === 'object' ? pages[pageKey] : {};
  const globalTextOverrides =
    composerSettings.textOverrides && typeof composerSettings.textOverrides === 'object' ? composerSettings.textOverrides : {};
  const globalStyleOverrides =
    composerSettings.styleOverrides && typeof composerSettings.styleOverrides === 'object' ? composerSettings.styleOverrides : {};
  const globalDomOrders =
    composerSettings.domOrders && typeof composerSettings.domOrders === 'object' ? composerSettings.domOrders : {};
  const pageTextOverrides =
    pageOverrides.textOverrides && typeof pageOverrides.textOverrides === 'object' ? pageOverrides.textOverrides : {};
  const pageStyleOverrides =
    pageOverrides.styleOverrides && typeof pageOverrides.styleOverrides === 'object' ? pageOverrides.styleOverrides : {};
  const pageDomOrders =
    pageOverrides.domOrders && typeof pageOverrides.domOrders === 'object' ? pageOverrides.domOrders : {};
  const composerTextOverrides = { ...globalTextOverrides, ...pageTextOverrides };
  const composerStyleOverrides = { ...globalStyleOverrides, ...pageStyleOverrides };
  const composerDomOrders = { ...globalDomOrders, ...pageDomOrders };
  const composerPayload = {
    themeCss: String(composerSettings.themeCss || ''),
    quickActionsOrder: Array.isArray(composerSettings.quickActionsOrder) ? composerSettings.quickActionsOrder : [],
    sideNavOrder: Array.isArray(composerSettings.sideNavOrder) ? composerSettings.sideNavOrder : [],
    pageAsideWidth: Number.isFinite(composerSettings.pageAsideWidth) ? composerSettings.pageAsideWidth : null,
    pageVerbosity: composerSettings.pageVerbosity || {},
    pageLayouts: composerSettings.pageLayouts || {},
    textOverrides: composerTextOverrides,
    styleOverrides: composerStyleOverrides,
    domOrders: composerDomOrders,
    globalOverrides: {
      textOverrides: globalTextOverrides,
      styleOverrides: globalStyleOverrides,
      domOrders: globalDomOrders,
    },
    pageOverrides: {
      textOverrides: pageTextOverrides,
      styleOverrides: pageStyleOverrides,
      domOrders: pageDomOrders,
    },
  };
  const composerSettingsAttr = escapeHtml(JSON.stringify(composerPayload));
  const roleLabel = data.roleLabel || data.person?.role || '';
  const isAdmin = String(roleLabel || '').toLowerCase() === 'admin';
  const uiSettingsServer = resolveInterfaceSettingsMeta(data.person);
  const verbosityMeta = resolveVerbosityMeta({ state, person: data.person, explicit: data.verbosityMode, pageKey });
  if (wantsPartial) {
    const pageMeta = renderPageMeta({
      pageKey,
      composerSettingsAttr,
      composerAllowed: isAdmin ? 'true' : '',
      uiSettingsServer,
      ...verbosityMeta,
    });
    return `${pageMeta}${statusStrip}${body}`;
  }
  const layout = await loadTemplate('layout');
  const layoutData = { ...actorLabels, ...data, body, title, statusStrip };
  layoutData.pageKey = pageKey;
  if (!layoutData.personHandle) {
    layoutData.personHandle = 'Guest session';
  }
  if (!layoutData.quickLinks || !layoutData.sideNav) {
    const nav = renderNav(state, layoutData);
    layoutData.quickLinks = layoutData.quickLinks || nav.quickLinks;
    layoutData.sideNav = layoutData.sideNav || nav.sideNav;
  }
  layoutData.verbosityMode = verbosityMeta.verbosityMode;
  layoutData.verbosityDefault = verbosityMeta.verbosityDefault;
  layoutData.verbosityOverride = verbosityMeta.verbosityOverride;
  layoutData.verbosityPagePreset = verbosityMeta.verbosityPagePreset;
  layoutData.verbosityToggleLabel = verbosityMeta.verbosityToggleLabel;
  layoutData.verbosityToggleSource = verbosityMeta.verbosityToggleSource;
  layoutData.verbosityCanSave = verbosityMeta.verbosityCanSave;
  if (!layoutData.themeCss) {
    layoutData.themeCss = String(state?.settings?.composer?.themeCss || '');
  }
  if (!layoutData.themeVars) {
    const asideWidth = state?.settings?.composer?.pageAsideWidth;
    layoutData.themeVars = asideWidth ? `--page-aside-width: ${asideWidth}px;` : '';
  }
  const brandDefaults = {
    eyebrow: 'Organization Web',
    title: state?.settings?.circleName || 'Organization',
    tagline: 'Communication first. Add structure only when it earns its place.',
    footer: 'SSR-first workspace with independently deployable organization and civic modules',
  };
  layoutData.brandEyebrow = resolveComposerTextEscaped(composerTextOverrides, 'layout.brandEyebrow', brandDefaults.eyebrow);
  layoutData.brandTitle = resolveComposerTextEscaped(composerTextOverrides, 'layout.brandTitle', brandDefaults.title);
  layoutData.brandTagline = resolveComposerTextEscaped(composerTextOverrides, 'layout.brandTagline', brandDefaults.tagline);
  layoutData.footerNote = resolveComposerTextEscaped(composerTextOverrides, 'layout.footerNote', brandDefaults.footer);
  layoutData.brandEyebrowDefault = escapeHtml(brandDefaults.eyebrow);
  layoutData.brandTitleDefault = escapeHtml(brandDefaults.title);
  layoutData.brandTaglineDefault = escapeHtml(brandDefaults.tagline);
  layoutData.footerNoteDefault = escapeHtml(brandDefaults.footer);
  layoutData.brandEyebrowStyle = resolveComposerStyle(composerStyleOverrides, 'layout.brandEyebrow');
  layoutData.brandTitleStyle = resolveComposerStyle(composerStyleOverrides, 'layout.brandTitle');
  layoutData.brandTaglineStyle = resolveComposerStyle(composerStyleOverrides, 'layout.brandTagline');
  layoutData.footerNoteStyle = resolveComposerStyle(composerStyleOverrides, 'layout.footerNote');
  if (!layoutData.composerSettingsAttr) {
    layoutData.composerSettingsAttr = composerSettingsAttr;
  }
  layoutData.composerAllowed = isAdmin ? 'true' : '';
  layoutData.uiSettingsServer = escapeHtml(uiSettingsServer);
  layoutData.composerControls = isAdmin ? buildComposerControls() : '';
  return applyTemplate(layout, layoutData);
}

export function resolveVerbosityMode({ state, person, explicit, pageKey } = {}) {
  const explicitMode = normalizeVerbosityMode(explicit);
  if (explicitMode) return explicitMode;
  const personMode = normalizeVerbosityMode(person?.uiVerbosity || person?.ui?.verbosity || person?.verbosityMode);
  if (personMode) return personMode;
  const pagePreset = normalizeVerbosityMode(state?.settings?.composer?.pageVerbosity?.[pageKey]);
  if (pagePreset) return pagePreset;
  const defaultMode = normalizeVerbosityMode(state?.settings?.verbosityMode);
  return defaultMode || 'full';
}

async function loadTemplate(name) {
  const { moduleName, filePath } = resolveTemplatePath(name);
  return loadTemplateFile(filePath, { moduleName });
}

function resolveTemplatePath(name) {
  const moduleName = TEMPLATE_MODULES[name];
  const filePath = moduleName
    ? join(MODULES_ROOT, moduleName, 'templates', `${name}.html`)
    : join(PATHS.TEMPLATE_ROOT, `${name}.html`);
  return { moduleName, filePath };
}

async function loadTemplateFile(filePath, { moduleName = '', stack = new Set() } = {}) {
  if (templateCache.has(filePath)) {
    return templateCache.get(filePath);
  }
  if (stack.has(filePath)) {
    return '';
  }
  stack.add(filePath);
  let content = await readFile(filePath, 'utf-8');
  content = await resolvePartials(content, { moduleName, stack });
  stack.delete(filePath);
  templateCache.set(filePath, content);
  return content;
}

async function resolvePartials(template, { moduleName, stack }) {
  const matches = Array.from(template.matchAll(/{{>\s*([^}]+)\s*}}/g));
  if (!matches.length) return template;
  let output = template;
  for (const match of matches) {
    const token = normalizePartialToken(match[1]);
    if (!token) {
      output = output.replace(match[0], '');
      continue;
    }
    const partial = await loadPartial(token, { moduleName, stack });
    output = output.replace(match[0], partial);
  }
  return output;
}

function normalizePartialToken(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (!/^[a-zA-Z0-9_./:-]+$/.test(trimmed)) return '';
  if (trimmed.includes('..')) return '';
  return trimmed;
}

async function loadPartial(token, { moduleName, stack }) {
  const { moduleName: targetModule, candidates } = resolvePartialCandidates(token, moduleName);
  for (const candidate of candidates) {
    try {
      return await loadTemplateFile(candidate, { moduleName: targetModule, stack });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return '';
}

function resolvePartialCandidates(token, moduleName) {
  let targetModule = moduleName;
  let partialName = token;
  if (token.includes(':')) {
    const parts = token.split(':');
    targetModule = parts[0] || moduleName;
    partialName = parts.slice(1).join(':') || '';
  }
  const baseDir = targetModule ? join(MODULES_ROOT, targetModule, 'templates') : PATHS.TEMPLATE_ROOT;
  if (!partialName) {
    return { moduleName: targetModule, candidates: [] };
  }
  const candidates = [];
  if (partialName.includes('/')) {
    candidates.push(join(baseDir, `${partialName}.html`));
  } else {
    candidates.push(join(baseDir, 'partials', `${partialName}.html`));
    candidates.push(join(baseDir, `${partialName}.html`));
  }
  return { moduleName: targetModule, candidates };
}

function applyTemplate(template, data) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolveVerbosityMeta({ state, person, explicit, pageKey } = {}) {
  const verbosityDefault = normalizeVerbosityMode(state?.settings?.verbosityMode) || 'full';
  const verbosityOverride = normalizeVerbosityMode(person?.uiVerbosity || person?.ui?.verbosity || person?.verbosityMode);
  const verbosityPagePreset = normalizeVerbosityMode(state?.settings?.composer?.pageVerbosity?.[pageKey]);
  const verbosityMode = resolveVerbosityMode({ state, person, explicit, pageKey });
  return {
    verbosityMode,
    verbosityDefault,
    verbosityOverride: verbosityOverride || '',
    verbosityPagePreset: verbosityPagePreset || '',
    verbosityToggleLabel: verbosityMode === 'compact' ? 'Compact' : 'Full',
    verbosityToggleSource: verbosityOverride ? 'Session override' : verbosityPagePreset ? 'Page preset' : 'Circle default',
    verbosityCanSave: person?.sessionId ? 'true' : '',
  };
}

function renderPageMeta(meta = {}) {
  const attrs = [
    'data-page-meta',
    meta.pageKey ? `data-page-key="${escapeHtml(meta.pageKey)}"` : '',
    `data-verbosity="${escapeHtml(meta.verbosityMode || '')}"`,
    `data-verbosity-default="${escapeHtml(meta.verbosityDefault || '')}"`,
    `data-verbosity-override="${escapeHtml(meta.verbosityOverride || '')}"`,
    `data-verbosity-page-preset="${escapeHtml(meta.verbosityPagePreset || '')}"`,
    `data-verbosity-can-save="${escapeHtml(meta.verbosityCanSave || '')}"`,
    meta.composerSettingsAttr ? `data-composer-settings="${meta.composerSettingsAttr}"` : '',
    meta.composerAllowed !== undefined ? `data-composer-allowed="${escapeHtml(meta.composerAllowed)}"` : '',
    meta.uiSettingsServer !== undefined ? `data-ui-settings-server="${escapeHtml(meta.uiSettingsServer)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div ${attrs} hidden></div>`;
}

function resolveInterfaceSettingsMeta(person = {}) {
  const raw = person?.uiSettings;
  if (!raw || typeof raw !== 'object') {
    return '{}';
  }
  const normalized = {
    largeText: raw.largeText === true,
    reducedMotion: raw.reducedMotion === true,
    compactNav: raw.compactNav === true,
    keepComposerOpen: raw.keepComposerOpen === true,
    partialNavigation: raw.partialNavigation !== false,
  };
  return JSON.stringify(normalized);
}

function buildComposerControls() {
  return `
    <div class="composer-tool" data-composer-tool data-composer-allowed="true">
      <div class="composer-tool__bar" data-composer-drag>
        <button class="composer-tool__fab" type="button" data-composer-toggle aria-expanded="false">Enter Composer</button>
        <div class="composer-tool__bar-actions">
          <button class="ghost composer-tool__bar-button" type="button" data-composer-save>Save</button>
          <button class="ghost composer-tool__bar-button" type="button" data-composer-cancel>Cancel</button>
        </div>
      </div>
      <aside class="composer-tool__panel" data-composer-panel aria-label="Composer tools">
        <div class="composer-tool__header" data-composer-drag>
          <div>
            <p class="eyebrow">Composer</p>
            <h3>Inline editor</h3>
          </div>
          <div class="composer-tool__header-actions">
            <button class="ghost composer-tool__collapse" type="button" data-composer-collapse aria-expanded="true">Collapse</button>
            <button class="ghost composer-tool__close" type="button" data-composer-close aria-label="Close composer">Close</button>
          </div>
        </div>
        <section class="composer-tool__section">
          <p class="muted small" data-composer-selection>Select a label or heading to edit.</p>
          <label class="field">
            <span>Text</span>
            <input type="text" data-composer-text-input placeholder="Edit selected text" />
          </label>
          <div class="cta-row">
            <button class="ghost" type="button" data-composer-apply>Apply text</button>
            <button class="ghost" type="button" data-composer-clear>Clear override</button>
          </div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Toolbar</p>
          <div class="composer-toolbar">
            <button class="ghost composer-toolbar__button" type="button" data-composer-toggle-style="fontWeight" data-composer-value="700">Bold</button>
            <button class="ghost composer-toolbar__button" type="button" data-composer-toggle-style="fontStyle" data-composer-value="italic">Italic</button>
            <button class="ghost composer-toolbar__button" type="button" data-composer-toggle-style="textDecoration" data-composer-value="underline">Underline</button>
          </div>
          <div class="composer-toolbar">
            <button class="ghost composer-toolbar__button" type="button" data-composer-style-set="textAlign" data-composer-value="left">Align left</button>
            <button class="ghost composer-toolbar__button" type="button" data-composer-style-set="textAlign" data-composer-value="center">Center</button>
            <button class="ghost composer-toolbar__button" type="button" data-composer-style-set="textAlign" data-composer-value="right">Align right</button>
          </div>
          <div class="composer-toolbar composer-toolbar--grid" data-composer-grid-controls hidden>
            <div class="form-grid">
              <label class="field">
                <span>Grid columns</span>
                <input type="text" data-composer-style="gridTemplateColumns" placeholder="repeat(3, minmax(0, 1fr))" />
              </label>
              <label class="field">
                <span>Gap</span>
                <input type="text" data-composer-style="gap" placeholder="1rem" />
              </label>
              <label class="field">
                <span>Align items</span>
                <select data-composer-style="alignItems">
                  <option value="">(no change)</option>
                  <option>start</option>
                  <option>center</option>
                  <option>end</option>
                  <option>stretch</option>
                </select>
              </label>
              <label class="field">
                <span>Justify content</span>
                <select data-composer-style="justifyContent">
                  <option value="">(no change)</option>
                  <option>start</option>
                  <option>center</option>
                  <option>end</option>
                  <option>space-between</option>
                  <option>space-around</option>
                  <option>space-evenly</option>
                </select>
              </label>
            </div>
          </div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Inspector</p>
          <p class="muted small" data-composer-inspector-note>Select a panel or label to edit.</p>
          <div class="form-grid">
            <label class="field">
              <span>Width</span>
              <input type="text" data-composer-style="width" placeholder="320px / 40% / auto" />
            </label>
            <label class="field">
              <span>Height</span>
              <input type="text" data-composer-style="height" placeholder="180px / auto" />
            </label>
            <label class="field">
              <span>Text color</span>
              <input type="text" data-composer-style="color" placeholder="#e8f1ff" />
            </label>
            <label class="field">
              <span>Background</span>
              <input type="text" data-composer-style="background" placeholder="rgba(11, 92, 255, 0.15)" />
            </label>
            <label class="field">
              <span>Font size</span>
              <input type="text" data-composer-style="fontSize" placeholder="1.1rem" />
            </label>
            <label class="field">
              <span>Border radius</span>
              <input type="text" data-composer-style="borderRadius" placeholder="12px" />
            </label>
            <label class="field">
              <span>Padding</span>
              <input type="text" data-composer-style="padding" placeholder="0.25rem 0.6rem" />
            </label>
            <label class="field">
              <span>Margin</span>
              <input type="text" data-composer-style="margin" placeholder="0.75rem 0" />
            </label>
            <label class="field">
              <span>Border</span>
              <input type="text" data-composer-style="border" placeholder="1px solid rgba(154, 177, 211, 0.3)" />
            </label>
            <label class="field">
              <span>Box shadow</span>
              <input type="text" data-composer-style="boxShadow" placeholder="0 12px 30px rgba(0,0,0,0.3)" />
            </label>
            <label class="field">
              <span>Display</span>
              <select data-composer-style="display">
                <option value="">(no change)</option>
                <option>block</option>
                <option>inline-block</option>
                <option>flex</option>
                <option>grid</option>
                <option>none</option>
              </select>
            </label>
            <label class="field">
              <span>Position</span>
              <select data-composer-style="position">
                <option value="">(no change)</option>
                <option>static</option>
                <option>relative</option>
                <option>absolute</option>
                <option>fixed</option>
              </select>
            </label>
            <label class="field">
              <span>Z-index</span>
              <input type="text" data-composer-style="zIndex" placeholder="10" />
            </label>
            <label class="field">
              <span>Left</span>
              <input type="text" data-composer-style="left" placeholder="20px" />
            </label>
            <label class="field">
              <span>Top</span>
              <input type="text" data-composer-style="top" placeholder="10px" />
            </label>
          </div>
          <label class="field">
            <span>Raw CSS declarations</span>
            <textarea data-composer-raw spellcheck="false" placeholder="background: rgba(255,255,255,0.08);&#10;border: 1px solid rgba(255,255,255,0.2);"></textarea>
          </label>
          <div class="cta-row">
            <button class="ghost" type="button" data-composer-raw-apply>Apply CSS</button>
            <button class="ghost" type="button" data-composer-raw-sync>Sync from selection</button>
            <button class="ghost" type="button" data-composer-style-clear>Clear styles</button>
          </div>
          <div class="cta-row">
            <button class="ghost" type="button" data-composer-move-up>Move up</button>
            <button class="ghost" type="button" data-composer-move-down>Move down</button>
          </div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Navigation order</p>
          <div class="composer-tool__lists">
            <div class="composer-tool__list-block">
              <p class="muted small">Quick actions</p>
              <ol class="composer-tool__list" data-composer-list="quick"></ol>
            </div>
            <div class="composer-tool__list-block" data-composer-side-lists></div>
          </div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Hierarchy</p>
          <div class="composer-tree" data-composer-tree></div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Layout</p>
          <div class="composer-tool__lists">
            <div class="composer-tool__list-block">
              <p class="muted small">Main column</p>
              <ol class="composer-tool__list" data-composer-list="main"></ol>
            </div>
            <div class="composer-tool__list-block" data-composer-aside-block>
              <p class="muted small">Side column</p>
              <ol class="composer-tool__list" data-composer-list="aside"></ol>
            </div>
          </div>
        </section>
        <section class="composer-tool__section">
          <p class="eyebrow">Page defaults</p>
          <p class="muted small" data-composer-page-label>Current page preset</p>
          <label class="field">
            <span>Verbosity preset</span>
            <select data-composer-page-verbosity>
              <option value="">Inherit Circle default</option>
              <option value="full">Full</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </section>
        <div class="composer-tool__footer">
          <p class="muted small" data-composer-status>Changes apply locally until saved.</p>
        </div>
      </aside>
    </div>
  `;
}
