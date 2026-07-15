import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PATHS } from '../../config.js';

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const DEFAULT_EXTENSION_VERSION = '0.0.0';

export async function loadExtensions({ list, installations } = {}) {
  const active = [];
  const names = Array.isArray(list) ? list : parseEnvList();
  const installed = installations === undefined
    ? null
    : normalizeExtensionInstallations(installations);

  for (const requestedName of names) {
    const name = normalizeExtensionId(requestedName);
    if (!name) {
      console.warn(`[extensions] Skipping invalid extension id "${requestedName}"`);
      continue;
    }
    const installation = installed?.find((entry) => entry.id === name || entry.file === normalizeName(name));
    if (installed && !installation) {
      console.warn(`[extensions] Skipping "${name}" (not installed)`);
      continue;
    }
    const file = installation?.file || normalizeName(name);
    const modPath = join(PATHS.EXTENSIONS_ROOT, file);
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
  const catalog = await discoverExtensionCatalog();
  const enabled = new Set((state.settings?.extensions || []).map((name) => normalizeExtensionId(name)).filter(Boolean));
  const activeIds = new Set((state.extensions?.active || []).map((ext) => ext.id));
  const installations = normalizeExtensionInstallations(
    state.settings?.extensionInstallations,
    state.settings?.extensions,
  );
  const installedById = new Map(installations.map((entry) => [entry.id, entry]));
  const entries = catalog.map((entry) => {
    const installation = installedById.get(entry.id);
    installedById.delete(entry.id);
    const installed = Boolean(installation);
    const installedVersion = installed ? installation.version || entry.version : null;
    return {
      ...entry,
      enabled: installed && enabled.has(entry.id),
      active: activeIds.has(entry.id),
      installed,
      installedVersion,
      installedAt: installation?.installedAt || null,
      updatedAt: installation?.updatedAt || null,
      updateAvailable: installed && installedVersion !== entry.version,
    };
  });

  for (const installation of installedById.values()) {
    entries.push({
      id: installation.id,
      file: installation.file,
      enabled: enabled.has(installation.id),
      active: activeIds.has(installation.id),
      installed: true,
      version: null,
      installedVersion: installation.version,
      installedAt: installation.installedAt,
      updatedAt: installation.updatedAt,
      updateAvailable: false,
      source: installation.source,
      meta: { error: 'Extension source file is missing from the provider catalog.' },
    });
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

export async function installExtension(state, rawId, { now = new Date().toISOString() } = {}) {
  const id = normalizeExtensionId(rawId);
  if (!id) throw extensionError('invalid_extension_id', `Invalid extension id "${rawId || ''}".`);
  const catalog = await discoverExtensionCatalog();
  const entry = catalog.find((candidate) => candidate.id === id);
  if (!entry) throw extensionError('extension_not_found', `Extension "${id}" is not in the provider catalog.`);
  if (entry.meta?.error) throw extensionError('extension_unavailable', entry.meta.error);

  const installations = normalizeExtensionInstallations(
    state.settings?.extensionInstallations,
    state.settings?.extensions,
  );
  const existing = installations.find((installation) => installation.id === id);
  const installation = {
    id,
    file: entry.file,
    version: entry.version,
    source: entry.source,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
  };
  state.settings = {
    ...(state.settings || {}),
    extensionInstallations: [
      ...installations.filter((candidate) => candidate.id !== id),
      installation,
    ],
  };
  return { installation, updated: Boolean(existing && existing.version !== entry.version) };
}

export function uninstallExtension(state, rawId) {
  const id = normalizeExtensionId(rawId);
  if (!id) throw extensionError('invalid_extension_id', `Invalid extension id "${rawId || ''}".`);
  const installations = normalizeExtensionInstallations(
    state.settings?.extensionInstallations,
    state.settings?.extensions,
  );
  const installed = installations.some((entry) => entry.id === id);
  state.settings = {
    ...(state.settings || {}),
    extensions: (state.settings?.extensions || [])
      .map((entry) => normalizeExtensionId(entry))
      .filter((entry) => entry && entry !== id),
    extensionInstallations: installations.filter((entry) => entry.id !== id),
  };
  return { id, uninstalled: installed };
}

export function normalizeExtensionInstallations(value, legacyEnabled = []) {
  const rawEntries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([id, entry]) => ({ id, ...(entry || {}) }))
      : [];
  const byId = new Map();
  for (const raw of rawEntries) {
    const id = normalizeExtensionId(raw?.id || raw?.name || raw?.file);
    if (!id) continue;
    byId.set(id, {
      id,
      file: normalizeName(normalizeExtensionId(raw?.file) || id),
      version: normalizeOptionalVersion(raw?.version),
      source: normalizeSource(raw?.source),
      installedAt: normalizeTimestamp(raw?.installedAt),
      updatedAt: normalizeTimestamp(raw?.updatedAt),
    });
  }
  for (const raw of legacyEnabled || []) {
    const id = normalizeExtensionId(raw);
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      file: normalizeName(id),
      version: null,
      source: 'legacy',
      installedAt: null,
      updatedAt: null,
    });
  }
  return [...byId.values()];
}

async function discoverExtensionCatalog() {
  let files;
  try {
    files = await readdir(PATHS.EXTENSIONS_ROOT);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const entries = [];
  for (const file of files.sort()) {
    if (!file.endsWith('.js')) continue;
    const modPath = join(PATHS.EXTENSIONS_ROOT, file);
    const moduleUrl = pathToFileURL(modPath).href;
    let meta = {};
    let id = normalizeExtensionId(file);
    try {
      const mod = await import(moduleUrl);
      const ext = mod.default || mod;
      id = normalizeExtensionId(ext.id || id);
      if (!id) {
        throw new Error('Extension exports an invalid id.');
      }
      meta = ext.meta && typeof ext.meta === 'object' ? ext.meta : {};
    } catch (error) {
      meta = { error: error.message };
    }
    if (!id) continue;
    entries.push({
      id,
      file,
      version: normalizeVersion(meta.version),
      source: normalizeSource(meta.source || (meta.bundled ? 'bundled' : 'provider-local')),
      meta,
    });
  }
  return entries;
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

function normalizeExtensionId(value) {
  const id = String(value || '').trim().replace(/\.js$/i, '');
  return EXTENSION_ID_PATTERN.test(id) ? id : '';
}

function normalizeVersion(value) {
  const version = String(value || '').trim();
  return version && version.length <= 64 ? version : DEFAULT_EXTENSION_VERSION;
}

function normalizeOptionalVersion(value) {
  if (value === null || value === undefined || value === '') return null;
  return normalizeVersion(value);
}

function normalizeSource(value) {
  const source = String(value || '').trim();
  return source && source.length <= 128 ? source : 'provider-local';
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeExtension(name, mod) {
  const id = normalizeExtensionId(mod.id || name);
  return {
    id,
    meta: mod.meta || {},
    extendActionRules: mod.extendActionRules,
    decorateDecision: mod.decorateDecision,
    classifyTopic: mod.classifyTopic,
    resolveDelegation: mod.resolveDelegation,
  };
}

function extensionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
