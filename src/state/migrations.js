export const LATEST_SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initialize schema and normalize persisted records.',
    up: (data) => {
      const normalizedSessions = (data.sessions || [])
        .map(normalizeSession)
        .filter(Boolean);

      const normalizedDiscussions = (data.discussions || [])
        .map(normalizeDiscussion)
        .filter(Boolean);

      const normalizedActors = (data.actors || [])
        .map(normalizeActor)
        .filter(Boolean);

      return {
        ledger: uniqueStrings(data.ledger),
        sessions: normalizedSessions,
        peers: uniqueStrings(data.peers),
        discussions: normalizedDiscussions,
        actors: normalizedActors,
      };
    },
  },
];

export function runMigrations({ data, meta }) {
  let currentVersion = meta?.schemaVersion || 0;
  const appliedHistory = meta?.migrations || [];
  let workingData = { ...data };
  const appliedNow = [];

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      workingData = migration.up(workingData);
      currentVersion = migration.version;
      appliedNow.push({
        version: migration.version,
        description: migration.description,
        appliedAt: new Date().toISOString(),
      });
    }
  }

  const nextMeta = {
    schemaVersion: currentVersion,
    migrations: [...appliedHistory, ...appliedNow],
  };

  return {
    data: workingData,
    meta: nextMeta,
    didMigrate: appliedNow.length > 0 || !meta?.schemaVersion,
  };
}

function normalizeSession(session) {
  const id = session.id || session.sessionId || session.sid;
  if (!id) return null;
  const status = session.status || (session.pidHash ? 'verified' : 'pending');
  return {
    id,
    status,
    issuedAt: session.issuedAt || Date.now(),
    verifiedAt: session.verifiedAt || session.confirmedAt || null,
    pidHash: session.pidHash || session.hash || null,
    salt: session.salt || session.nonce || '',
    offer: session.offer || session.credentialOffer || null,
    actorId: session.actorId || null,
  };
}

function normalizeDiscussion(entry, index) {
  const content = stringOrEmpty(entry.content);
  if (!content) return null;
  return {
    id: entry.id || `legacy-${index}`,
    topic: stringOrFallback(entry.topic, 'General'),
    stance: stringOrFallback(entry.stance, 'neutral'),
    content,
    authorHash: stringOrFallback(entry.authorHash, 'anonymous'),
    createdAt: entry.createdAt || entry.timestamp || new Date().toISOString(),
  };
}

function normalizeActor(actor) {
  const hash = actor.hash || deriveHashFromActorId(actor.id);
  if (!hash) return null;
  return {
    '@context': actor['@context'] || 'https://www.w3.org/ns/activitystreams',
    id: actor.id || '',
    type: actor.type || 'Person',
    preferredUsername: actor.preferredUsername || hash.slice(0, 12),
    inbox: actor.inbox || '',
    outbox: actor.outbox || '',
    hash,
    published: actor.published || actor.createdAt || new Date().toISOString(),
  };
}

function deriveHashFromActorId(actorId) {
  if (!actorId) return '';
  const segments = String(actorId).split('/');
  return segments[segments.length - 1] || '';
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrFallback(value, fallback) {
  const text = stringOrEmpty(value);
  return text || fallback;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}
