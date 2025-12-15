import { runMigrations } from './migrations.js';
import { createStateStore } from './store.js';

export async function initState() {
  const store = createStateStore();
  await store.prepare();

  const rawData = await store.loadData();
  const meta = await store.loadMeta();
  const { data: migratedData, meta: migratedMeta, didMigrate } = runMigrations({ data: rawData, meta });

  if (didMigrate) {
    await store.saveData(migratedData);
    await store.saveMeta(migratedMeta);
  }

  const state = hydrateState(migratedData);
  state.meta = migratedMeta;
  state.store = store;
  return state;
}

export async function persistLedger(state) {
  await state.store.saveLedger([...state.uniquenessLedger]);
}

export async function persistSessions(state) {
  await state.store.saveSessions([...state.sessions.values()]);
}

export async function persistPeers(state) {
  await state.store.savePeers([...state.peers]);
}

export async function persistDiscussions(state) {
  await state.store.saveDiscussions(state.discussions);
}

export async function persistActors(state) {
  await state.store.saveActors([...state.actors.values()]);
}

function hydrateState(data) {
  return {
    uniquenessLedger: new Set(data.ledger),
    sessions: new Map(data.sessions.map((session) => [session.id, session])),
    peers: new Set(data.peers),
    discussions: data.discussions,
    actors: new Map(data.actors.map((actor) => [actor.hash, actor])),
  };
}
