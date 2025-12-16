export const LATEST_SCHEMA_VERSION = 5;

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
  {
    version: 2,
    description: 'Add admin settings scaffold with defaults.',
    up: (data) => {
      return {
        ...data,
        settings: {
          initialized: Boolean(data.settings?.initialized),
          circleName: data.settings?.circleName || 'Party Circle',
          policyId: data.settings?.policyId || 'party-circle-alpha',
          enforceCircle: data.settings?.enforceCircle ?? null,
          requireVerification: data.settings?.requireVerification ?? null,
          adminContact: data.settings?.adminContact || '',
          preferredPeer: data.settings?.preferredPeer || '',
          notes: data.settings?.notes || '',
        },
      };
    },
  },
  {
    version: 3,
    description: 'Add session handles/roles for Circle policy gates.',
    up: (data) => {
      const sessions = (data.sessions || []).map((session) => {
        const pidHash = session.pidHash || session.hash || null;
        return {
          ...session,
          role: session.role || 'citizen',
          handle: session.handle || deriveHandleFromPid(pidHash, session.id || session.sessionId || session.sid),
          banned: Boolean(session.banned),
        };
      });
      return { ...data, sessions };
    },
  },
  {
    version: 4,
    description: 'Add petitions/votes scaffolds and extension settings.',
    up: (data) => {
      return {
        ...data,
        petitions: data.petitions || [],
        votes: data.votes || [],
        settings: {
          ...(data.settings || {}),
          extensions: data.settings?.extensions || parseEnvExtensions(),
        },
      };
    },
  },
  {
    version: 5,
    description: 'Add delegations/notifications/groups scaffolds and petition lifecycle defaults.',
    up: (data) => {
      const petitions = (data.petitions || []).map((petition, index) => ({
        id: petition.id || `legacy-petition-${index}`,
        title: petition.title || 'Untitled petition',
        summary: petition.summary || '',
        authorHash: petition.authorHash || 'anonymous',
        createdAt: petition.createdAt || new Date().toISOString(),
        status: petition.status || 'draft',
        quorum: petition.quorum || 0,
        topic: petition.topic || 'general',
      }));
      const votes = (data.votes || []).map((vote) => ({
        petitionId: vote.petitionId || '',
        authorHash: vote.authorHash || 'anonymous',
        choice: vote.choice || 'abstain',
        createdAt: vote.createdAt || new Date().toISOString(),
      }));
      return {
        ...data,
        petitions,
        votes,
        delegations: data.delegations || [],
        notifications: data.notifications || [],
        groups: data.groups || [],
        signatures: data.signatures || [],
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
  const pidHash = session.pidHash || session.hash || null;
  return {
    id,
    status,
    issuedAt: session.issuedAt || Date.now(),
    verifiedAt: session.verifiedAt || session.confirmedAt || null,
    pidHash,
    salt: session.salt || session.nonce || '',
    offer: session.offer || session.credentialOffer || null,
    actorId: session.actorId || null,
    role: session.role || 'citizen',
    handle: session.handle || deriveHandleFromPid(pidHash, id),
    banned: Boolean(session.banned),
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

function deriveHandleFromPid(pidHash, fallbackId) {
  if (pidHash) {
    return `citizen-${String(pidHash).slice(0, 8)}`;
  }
  if (fallbackId) {
    return `session-${String(fallbackId).slice(0, 8)}`;
  }
  return 'citizen';
}

function parseEnvExtensions() {
  const raw = process.env.CIRCLE_EXTENSIONS || '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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
