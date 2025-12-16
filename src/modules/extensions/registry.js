import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PATHS } from '../../config.js';

export async function loadExtensions({ list } = {}) {
  const active = [];
  const names = list && list.length ? list : parseEnvList();
  for (const name of names) {
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

export async function listAvailableExtensions(state) {
  try {
    const files = await (await import('node:fs/promises')).readdir(PATHS.EXTENSIONS_ROOT);
    const enabled = new Set((state.settings?.extensions || []).map((name) => normalizeName(name)));
    const activeIds = new Set((state.extensions?.active || []).map((ext) => ext.id));
    const entries = [];
    for (const file of files) {
      if (!file.endsWith('.js')) continue;
      const modPath = join(PATHS.EXTENSIONS_ROOT, file);
      const moduleUrl = pathToFileURL(modPath).href;
      let meta = {};
      let id = file.replace(/\.js$/, '');
      try {
        const mod = await import(moduleUrl);
        const ext = mod.default || mod;
        id = ext.id || id;
        meta = ext.meta || {};
      } catch (error) {
        meta = { error: error.message };
      }
      entries.push({
        id,
        file,
        enabled: enabled.has(file) || enabled.has(id),
        active: activeIds.has(id),
        meta,
      });
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function parseEnvList() {
  return (process.env.CIRCLE_EXTENSIONS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeName(name) {
  return name.endsWith('.js') ? name : `${name}.js`;
}

function normalizeExtension(name, mod) {
  const id = mod.id || name.replace(/\.js$/, '');
  return {
    id,
    meta: mod.meta || {},
    extendActionRules: mod.extendActionRules,
    decorateDecision: mod.decorateDecision,
    classifyTopic: mod.classifyTopic,
    resolveDelegation: mod.resolveDelegation,
  };
}
