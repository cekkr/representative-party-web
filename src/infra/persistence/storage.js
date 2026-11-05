import { DATA, DATA_DEFAULTS, normalizeDataAdapter, normalizeDataMode, normalizeValidationLevel } from '../../config.js';
import { ensureSigningKeysInEnv } from '../../modules/circle/signingKeys.js';
import { runMigrations } from './migrations.js';
import { createStateStore } from './store.js';
import { buildActivityPubIndexSnapshot } from '../../modules/social/posts.js';

export async function initState() {
  const store = createStateStore({ adapter: DATA.adapter, sqliteFile: DATA.sqliteFile, kvFile: DATA.kvFile });
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
  state.dataConfig = deriveDataConfig(state.settings);
  state.settings = { ...(state.settings || {}), data: state.dataConfig };
  ensureSigningKeysInEnv(state);
  state.issuer = state.settings?.issuer || process.env.CIRCLE_ISSUER || state.issuer || 'local-circle';
  if (shouldRefreshActivityPubIndex(state)) {
    const snapshot = buildActivityPubIndexSnapshot(state);
    await state.store.saveActivityPubIndex(snapshot);
  }
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

export async function persistOrganizationCases(state, cases) {
  await state.store.saveOrganizationCases(cases);
  state.organizationCases = cases;
}

export async function persistPetitions(state) {
  await state.store.savePetitions(state.petitions);
}

export async function persistSignatures(state) {
  await state.store.saveSignatures(state.signatures);
}

export async function persistVotes(state) {
  await state.store.saveVotes(state.votes);
}

export async function persistDelegations(state) {
  await state.store.saveDelegations(state.delegations);
}

export async function persistNotifications(state) {
  await state.store.saveNotifications(state.notifications);
}

export async function persistTopics(state) {
  await state.store.saveTopics(state.topics || []);
}

export async function persistSocialFollows(state) {
  await state.store.saveSocialFollows(state.socialFollows);
}

export async function persistSocialPosts(state) {
  await state.store.saveSocialPosts(state.socialPosts);
  await persistActivityPubIndex(state);
}

export async function persistActivityPubIndex(state) {
  const snapshot = buildActivityPubIndexSnapshot(state);
  await state.store.saveActivityPubIndex(snapshot);
}

export async function persistSocialMedia(state) {
  await state.store.saveSocialMedia(state.socialMedia || []);
}

export async function persistGroups(state) {
  await state.store.saveGroups(state.groups);
}

export async function persistGroupPolicies(state) {
  await state.store.saveGroupPolicies(state.groupPolicies);
}

export async function persistGroupElections(state) {
  await state.store.saveGroupElections(state.groupElections);
}

export async function persistActors(state) {
  await state.store.saveActors([...state.actors.values()]);
}

export async function persistSettings(state) {
  await state.store.saveSettings(state.settings);
}

export async function persistProfileStructures(state) {
  await state.store.saveProfileStructures(state.profileStructures || []);
}

export async function persistProfileAttributes(state) {
  await state.store.saveProfileAttributes(state.profileAttributes || []);
}

export async function persistTransactions(state) {
  await state.store.saveTransactions(state.transactions || []);
}

export async function persistTransactionSummaries(state) {
  await state.store.saveTransactionSummaries(state.transactionSummaries || []);
}

function hydrateState(data) {
  const settings = data.settings || { initialized: false };
  return {
    uniquenessLedger: new Set(data.ledger),
    sessions: new Map(data.sessions.map((session) => [session.id, session])),
    peers: new Set(data.peers),
    discussions: data.discussions,
    organizationCases: data.organizationCases || [],
    petitions: data.petitions,
    signatures: data.signatures,
    votes: data.votes,
    delegations: data.delegations,
    notifications: data.notifications,
    topics: data.topics || [],
    groups: data.groups,
    groupPolicies: data.groupPolicies,
    groupElections: data.groupElections,
    actors: new Map(data.actors.map((actor) => [actor.hash, actor])),
    socialFollows: data.socialFollows || [],
    socialPosts: data.socialPosts || [],
    socialMedia: data.socialMedia || [],
    activityPubIndex: data.activityPubIndex || null,
    transactions: data.transactions || [],
    transactionSummaries: data.transactionSummaries || [],
    profileStructures: data.profileStructures || [],
    profileAttributes: data.profileAttributes || [],
    settings,
  };
}

function shouldRefreshActivityPubIndex(state) {
  const posts = state?.socialPosts || [];
  if (!posts.length) return false;
  const snapshot = state?.activityPubIndex;
  if (!snapshot || typeof snapshot !== 'object') return true;
  if (!Array.isArray(snapshot.objectIds) || !Array.isArray(snapshot.activityIds)) return true;
  const headId = posts[0]?.id || '';
  const tailId = posts[posts.length - 1]?.id || '';
  if ((snapshot.size || 0) !== posts.length) return true;
  if ((snapshot.headId || '') !== headId) return true;
  if ((snapshot.tailId || '') !== tailId) return true;
  return false;
}

function deriveDataConfig(settings = {}) {
  const stored = settings.data || {};
  return {
    mode: normalizeDataMode(DATA.mode || stored.mode || DATA_DEFAULTS.mode),
    adapter: normalizeDataAdapter(DATA.adapter || stored.adapter || DATA_DEFAULTS.adapter),
    validationLevel: normalizeValidationLevel(DATA.validationLevel || stored.validationLevel || DATA_DEFAULTS.validationLevel),
    allowPreviews: DATA.allowPreviews ?? stored.allowPreviews ?? DATA_DEFAULTS.allowPreviews,
  };
}
