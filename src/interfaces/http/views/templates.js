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

export async function renderPage(templateName, data = {}, { wantsPartial = false, title = DEFAULT_PAGE_TITLE, state } = {}) {
  const bodyTemplate = await loadTemplate(templateName);
  const actorLabels = getActorLabels(state);
  const body = applyTemplate(bodyTemplate, { ...actorLabels, ...data });
  const statusStrip = data.statusStrip !== undefined ? data.statusStrip : renderStatusStrip(deriveStatusMeta(state));
  if (wantsPartial) return `${statusStrip}${body}`;
  const layout = await loadTemplate('layout');
  const layoutData = { ...actorLabels, ...data, body, title, statusStrip };
  if (!layoutData.personHandle) {
    layoutData.personHandle = 'Guest session';
  }
  if (!layoutData.quickLinks || !layoutData.sideNav) {
    const nav = renderNav(state, layoutData);
    layoutData.quickLinks = layoutData.quickLinks || nav.quickLinks;
    layoutData.sideNav = layoutData.sideNav || nav.sideNav;
  }
  layoutData.verbosityMode = resolveVerbosityMode({
    state,
    person: layoutData.person,
    explicit: layoutData.verbosityMode,
  });
  if (!layoutData.themeCss) {
    layoutData.themeCss = String(state?.settings?.composer?.themeCss || '');
  }
  if (!layoutData.themeVars) {
    const asideWidth = state?.settings?.composer?.pageAsideWidth;
    layoutData.themeVars = asideWidth ? `--page-aside-width: ${asideWidth}px;` : '';
  }
  const composerSettings = state?.settings?.composer || {};
  const composerTextOverrides =
    composerSettings.textOverrides && typeof composerSettings.textOverrides === 'object' ? composerSettings.textOverrides : {};
  const composerStyleOverrides =
    composerSettings.styleOverrides && typeof composerSettings.styleOverrides === 'object' ? composerSettings.styleOverrides : {};
  const brandDefaults = {
    eyebrow: 'Representative Party Framework',
    title: 'Party Circle',
    tagline: 'Verifier-first kernel with QR handoff and ActivityPub hooks.',
    footer: 'Vanilla SSR + Party Circle kernel prototype',
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
    const payload = {
      themeCss: String(composerSettings.themeCss || ''),
      quickActionsOrder: Array.isArray(composerSettings.quickActionsOrder) ? composerSettings.quickActionsOrder : [],
      sideNavOrder: Array.isArray(composerSettings.sideNavOrder) ? composerSettings.sideNavOrder : [],
      pageAsideWidth: Number.isFinite(composerSettings.pageAsideWidth) ? composerSettings.pageAsideWidth : null,
      textOverrides: composerTextOverrides,
      styleOverrides: composerStyleOverrides,
    };
    layoutData.composerSettingsAttr = escapeHtml(JSON.stringify(payload));
  }
  const roleLabel = layoutData.roleLabel || layoutData.person?.role || '';
  const isAdmin = String(roleLabel || '').toLowerCase() === 'admin';
  layoutData.composerAllowed = isAdmin ? 'true' : '';
  layoutData.composerControls = isAdmin ? buildComposerControls() : '';
  return applyTemplate(layout, layoutData);
}

export function resolveVerbosityMode({ state, person, explicit } = {}) {
  const explicitMode = normalizeVerbosityMode(explicit);
  if (explicitMode) return explicitMode;
  const personMode = normalizeVerbosityMode(person?.uiVerbosity || person?.ui?.verbosity || person?.verbosityMode);
  if (personMode) return personMode;
  const defaultMode = normalizeVerbosityMode(state?.settings?.verbosityMode);
  return defaultMode || 'full';
}

async function loadTemplate(name) {
  if (templateCache.has(name)) {
    return templateCache.get(name);
  }
  const filePath = join(PATHS.TEMPLATE_ROOT, `${name}.html`);
  const content = await readFile(filePath, 'utf-8');
  templateCache.set(name, content);
  return content;
}

function applyTemplate(template, data) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function buildComposerControls() {
  return `
    <div class="composer-tool" data-composer-tool>
      <button class="composer-tool__fab" type="button" data-composer-toggle aria-expanded="false">Composer</button>
      <aside class="composer-tool__panel" data-composer-panel aria-label="Composer tools">
        <div class="composer-tool__header">
          <div>
            <p class="eyebrow">Composer</p>
            <h3>Inline editor</h3>
          </div>
          <button class="ghost composer-tool__close" type="button" data-composer-close aria-label="Close composer">Close</button>
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
          <p class="eyebrow">Style</p>
          <div class="form-grid">
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
              <span>Padding</span>
              <input type="text" data-composer-style="padding" placeholder="0.25rem 0.6rem" />
            </label>
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
          <p class="eyebrow">Layout</p>
          <div class="composer-tool__lists">
            <div class="composer-tool__list-block">
              <p class="muted small">Main column</p>
              <ol class="composer-tool__list" data-composer-list="main"></ol>
            </div>
            <div class="composer-tool__list-block">
              <p class="muted small">Side column</p>
              <ol class="composer-tool__list" data-composer-list="aside"></ol>
            </div>
          </div>
        </section>
        <div class="composer-tool__footer">
          <button class="cta" type="button" data-composer-save>Save composer changes</button>
          <p class="muted small" data-composer-status>Changes apply locally until saved.</p>
        </div>
      </aside>
    </div>
  `;
}
