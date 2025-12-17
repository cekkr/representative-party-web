import { DATA_DEFAULTS, normalizeDataAdapter, normalizeDataMode, normalizeValidationLevel } from '../../config.js';

export const LATEST_SCHEMA_VERSION = 12;

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
        groupPolicies: data.groupPolicies || [],
      };
    },
  },
  {
    version: 6,
    description: 'Add group elections persistence scaffold.',
    up: (data) => {
      return {
        ...data,
        groupElections: data.groupElections || [],
      };
    },
  },
  {
    version: 7,
    description: 'Add data topology and adapter settings.',
    up: (data) => {
      const settings = data.settings || {};
      const stored = settings.data || {};
      const dataConfig = {
        mode: normalizeDataMode(stored.mode || DATA_DEFAULTS.mode),
        adapter: normalizeDataAdapter(stored.adapter || DATA_DEFAULTS.adapter),
        validationLevel: normalizeValidationLevel(stored.validationLevel || DATA_DEFAULTS.validationLevel),
        allowPreviews: stored.allowPreviews ?? DATA_DEFAULTS.allowPreviews,
      };
      return {
        ...data,
        settings: { ...settings, data: dataConfig },
      };
    },
  },
  {
    version: 8,
    description: 'Add validationStatus to discussions, petitions, votes, and signatures for preview gating.',
    up: (data) => {
      const withValidation = (list) => (list || []).map((entry) => ({ validationStatus: entry.validationStatus || 'validated', ...entry }));
      return {
        ...data,
        discussions: withValidation(data.discussions),
        petitions: withValidation(data.petitions),
        votes: withValidation(data.votes),
        signatures: withValidation(data.signatures),
      };
    },
  },
  {
    version: 9,
    description: 'Add validationStatus to groups, group policies, elections, delegations, and notifications for preview gating.',
    up: (data) => {
      const withValidation = (list) => (list || []).map((entry) => ({ validationStatus: entry.validationStatus || 'validated', ...entry }));
      return {
        ...data,
        groups: withValidation(data.groups),
        groupPolicies: withValidation(data.groupPolicies),
        groupElections: withValidation(data.groupElections),
        delegations: withValidation(data.delegations),
        notifications: withValidation(data.notifications),
      };
    },
  },
  {
    version: 10,
    description: 'Add social follows/posts scaffolds with validation status.',
    up: (data) => {
      const normalizeFollow = (edge = {}, index) => {
        const followerHash = stringOrEmpty(edge.followerHash) || stringOrEmpty(edge.authorHash) || `legacy-follower-${index}`;
        const targetHash = stringOrEmpty(edge.targetHash) || stringOrEmpty(edge.subjectHash) || `legacy-target-${index}`;
        const followType = stringOrFallback(edge.type, 'circle');
        return {
          id: edge.id || `follow-${index}`,
          followerHash,
          targetHash,
          targetHandle: stringOrEmpty(edge.targetHandle),
          type: followType.slice(0, 32),
          createdAt: edge.createdAt || new Date().toISOString(),
          validationStatus: edge.validationStatus || 'validated',
        };
      };
      const normalizePost = (post = {}, index) => {
        const content = stringOrEmpty(post.content);
        if (!content) return null;
        return {
          id: post.id || `post-${index}`,
          authorHash: stringOrFallback(post.authorHash, 'anonymous'),
          authorHandle: stringOrEmpty(post.authorHandle),
          content: content.slice(0, 480),
          createdAt: post.createdAt || new Date().toISOString(),
          replyTo: post.replyTo || null,
          visibility: post.visibility === 'direct' ? 'direct' : 'public',
          targetHash: stringOrEmpty(post.targetHash),
          targetHandle: stringOrEmpty(post.targetHandle),
          validationStatus: post.validationStatus || 'validated',
        };
      };
      return {
        ...data,
        socialFollows: (data.socialFollows || []).map(normalizeFollow),
        socialPosts: (data.socialPosts || []).map(normalizePost).filter(Boolean),
      };
    },
  },
  {
    version: 11,
    description: 'Add issuer/provenance stamps to social follows/posts.',
    up: (data) => {
      const enhance = (entry = {}, index, kind) => {
        const issuer = entry.issuer || 'unknown';
        const provenance = entry.provenance || {
          issuer,
          mode: entry.mode || DATA_DEFAULTS.mode,
          adapter: entry.adapter || DATA_DEFAULTS.adapter,
        };
        return {
          ...entry,
          issuer,
          provenance,
          validatedAt: entry.validatedAt || (entry.validationStatus === 'preview' ? null : new Date().toISOString()),
          validatedBy: entry.validatedBy || (entry.validationStatus === 'preview' ? null : issuer),
          id: entry.id || `${kind}-${index}`,
        };
      };
      return {
        ...data,
        socialFollows: (data.socialFollows || []).map((entry, idx) => enhance(entry, idx, 'follow')),
        socialPosts: (data.socialPosts || []).map((entry, idx) => enhance(entry, idx, 'post')),
      };
    },
  },
  {
    version: 12,
    description: 'Add provider-local profile structure and attributes scaffolds.',
    up: (data) => {
      const structures = Array.isArray(data.profileStructures) ? data.profileStructures : [];
      const attributes = Array.isArray(data.profileAttributes) ? data.profileAttributes : [];
      return {
        ...data,
        profileStructures: structures,
        profileAttributes: attributes,
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
