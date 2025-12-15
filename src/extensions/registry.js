import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PATHS } from '../config.js';

const envList = (process.env.CIRCLE_EXTENSIONS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export async function loadExtensions() {
  const active = [];
  for (const name of envList) {
    const normalized = name.endsWith('.js') ? name : `${name}.js`;
    const modPath = join(PATHS.EXTENSIONS_ROOT, normalized);
    if (!existsSync(modPath)) {
      console.warn(`[extensions] Skipping "${name}" (not found at ${modPath})`);
      continue;
    }
    try {
      const moduleUrl = pathToFileURL(modPath).href;
      const mod = await import(moduleUrl);
      const extension = normalizeExtension(name, mod.default || mod);
      active.push(extension);
      console.log(`[extensions] Loaded "${extension.id}"`);
    } catch (error) {
      console.error(`[extensions] Failed to load "${name}":`, error.message);
    }
  }
  return { active };
}

function normalizeExtension(name, mod) {
  const id = mod.id || name.replace(/\.js$/, '');
  return {
    id,
    meta: mod.meta || {},
    extendActionRules: mod.extendActionRules,
    decorateDecision: mod.decorateDecision,
  };
}
