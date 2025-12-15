import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { FILES, PATHS } from '../config.js';

export async function initState() {
  await mkdir(PATHS.DATA_ROOT, { recursive: true });
  return loadState();
}

async function loadState() {
  const uniquenessLedger = new Set(await readJson(FILES.ledger, []));
  const sessions = new Map((await readJson(FILES.sessions, [])).map((session) => [session.id, session]));
  const peers = new Set(await readJson(FILES.peers, []));
  const discussions = await readJson(FILES.discussions, []);
  const actors = new Map((await readJson(FILES.actors, [])).map((actor) => [actor.hash, actor]));
  return { uniquenessLedger, sessions, peers, discussions, actors };
}

export async function persistLedger(state) {
  await writeJson(FILES.ledger, [...state.uniquenessLedger]);
}

export async function persistSessions(state) {
  await writeJson(FILES.sessions, [...state.sessions.values()]);
}

export async function persistPeers(state) {
  await writeJson(FILES.peers, [...state.peers]);
}

export async function persistDiscussions(state) {
  await writeJson(FILES.discussions, state.discussions);
}

export async function persistActors(state) {
  await writeJson(FILES.actors, [...state.actors.values()]);
}

async function readJson(filePath, fallback) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}
