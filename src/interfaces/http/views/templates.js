import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_PAGE_TITLE, PATHS } from '../../../config.js';
import { getActorLabels } from './actorLabel.js';
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
  if (!layoutData.navLinks) {
    layoutData.navLinks = renderNav(state);
  }
  return applyTemplate(layout, layoutData);
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
