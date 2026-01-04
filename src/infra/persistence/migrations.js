import { randomUUID } from 'node:crypto';

import { DATA_DEFAULTS, normalizeDataAdapter, normalizeDataMode, normalizeValidationLevel } from '../../config.js';
import { normalizeModuleSettings } from '../../modules/circle/modules.js';

export const LATEST_SCHEMA_VERSION = 19;

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
        ...data,
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
          role: session.role || 'person',
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
        body: petition.body || petition.text || '',
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
  {
    version: 13,
    description: 'Add transactions registry scaffold.',
    up: (data) => {
      return {
        ...data,
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
      };
    },
  },
  {
    version: 14,
    description: 'Add module toggle settings scaffold.',
    up: (data) => {
      const settings = data.settings || {};
      return {
        ...data,
        settings: {
          ...settings,
          modules: normalizeModuleSettings(settings.modules || {}),
        },
      };
    },
  },
  {
    version: 15,
    description: 'Add transaction summary gossip scaffold.',
    up: (data) => {
      return {
        ...data,
        transactionSummaries: Array.isArray(data.transactionSummaries) ? data.transactionSummaries : [],
      };
    },
  },
  {
    version: 16,
    description: 'Add topic registry scaffold and stamp topic ids.',
    up: (data) => {
      const now = new Date().toISOString();
      const topics = Array.isArray(data.topics) ? data.topics : [];
      const topicIndex = new Map();

      for (const [index, topic] of topics.entries()) {
        const label = stringOrFallback(topic?.label, `topic-${index}`);
        const key = normalizeTopicKey(topic?.key || label);
        const pathKey = topic?.pathKey || key;
        topic.id = topic.id || randomUUID();
        topic.label = label;
        topic.key = key;
        topic.slug = topic.slug || key;
        topic.pathKey = pathKey;
        topic.validationStatus = topic.validationStatus || 'validated';
        topic.createdAt = topic.createdAt || now;
        topic.updatedAt = topic.updatedAt || now;
        topicIndex.set(pathKey, topic);
      }

      const ensureTopicPath = (rawTopic) => {
        const labels = parseTopicPath(rawTopic);
        let parentId = null;
        let parentPathKey = '';
        const pathLabels = [];
        for (let depth = 0; depth < labels.length; depth += 1) {
          const label = labels[depth];
          const key = normalizeTopicKey(label);
          const pathKey = parentPathKey ? `${parentPathKey}/${key}` : key;
          let topic = topicIndex.get(pathKey);
          if (!topic) {
            topic = {
              id: randomUUID(),
              key,
              label,
              slug: key,
              parentId,
              pathKey,
              depth,
              aliases: [],
              history: [],
              validationStatus: 'validated',
              createdAt: now,
              updatedAt: now,
            };
            topics.push(topic);
            topicIndex.set(pathKey, topic);
          }
          pathLabels.push(topic.label || label);
          parentId = topic.id;
          parentPathKey = pathKey;
        }
        return { topicId: parentId, pathLabels };
      };

      const withTopic = (entry) => {
        if (!entry) return entry;
        if (entry.topicId || entry.topicPath) return entry;
        const { topicId, pathLabels } = ensureTopicPath(entry.topic || 'general');
        return { ...entry, topicId, topicPath: pathLabels };
      };

      return {
        ...data,
        topics,
        discussions: (data.discussions || []).map(withTopic),
        petitions: (data.petitions || []).map(withTopic),
      };
    },
  },
  {
    version: 17,
    description: 'Add petition revision history and update stamps.',
    up: (data) => {
      const now = new Date().toISOString();
      const petitions = (data.petitions || []).map((petition, index) => {
        const petitionId = petition.id || `legacy-petition-${index}`;
        const createdAt = petition.createdAt || now;
        const updatedAt = petition.updatedAt || createdAt;
        const updatedBy = petition.updatedBy || petition.authorHash || 'anonymous';
        const baseRevision = {
          id: randomUUID(),
          petitionId,
          title: petition.title || 'Untitled petition',
          summary: petition.summary || '',
          body: petition.body || petition.text || '',
          note: 'Initial draft',
          authorHash: petition.authorHash || 'anonymous',
          authorHandle: petition.authorHandle || null,
          topic: petition.topic || 'general',
          topicId: petition.topicId || null,
          topicPath: Array.isArray(petition.topicPath) ? petition.topicPath : [],
          createdAt,
        };
        const existingRevisions = Array.isArray(petition.versions) ? petition.versions : [];
        const versions = existingRevisions.length
          ? existingRevisions.map((revision, revIndex) => normalizeRevision(revision, petition, revIndex, now))
          : [baseRevision];
        return {
          ...petition,
          id: petitionId,
          createdAt,
          updatedAt,
          updatedBy,
          versions,
        };
      });
      return { ...data, petitions };
    },
  },
  {
    version: 18,
    description: 'Add social media attachment scaffolds.',
    up: (data) => {
      const socialMedia = Array.isArray(data.socialMedia) ? data.socialMedia : [];
      const socialPosts = (data.socialPosts || []).map((post) => {
        const mediaIds = Array.isArray(post.mediaIds) ? post.mediaIds : [];
        const reshare = post.reshare
          ? { ...post.reshare, mediaIds: Array.isArray(post.reshare.mediaIds) ? post.reshare.mediaIds : [] }
          : post.reshare;
        return { ...post, mediaIds, reshare };
      });
      return {
        ...data,
        socialMedia,
        socialPosts,
      };
    },
  },
  {
    version: 19,
    description: 'Add petition evidence fields and fact-check flags.',
    up: (data) => {
      const petitions = (data.petitions || []).map((petition) => {
        const evidenceSummary = stringOrEmpty(petition.evidenceSummary);
        const evidenceLinks = normalizeEvidenceLinks(petition.evidenceLinks);
        const versions = (Array.isArray(petition.versions) ? petition.versions : []).map((revision) => {
          const revSummary = stringOrEmpty(revision.evidenceSummary) || evidenceSummary;
          const revLinks = normalizeEvidenceLinks(revision.evidenceLinks);
          return {
            ...revision,
            evidenceSummary: revSummary,
            evidenceLinks: revLinks.length ? revLinks : evidenceLinks,
          };
        });
        const freeze = petition.freeze
          ? {
              ...petition.freeze,
              evidenceSummary: stringOrEmpty(petition.freeze.evidenceSummary) || evidenceSummary,
              evidenceLinks: normalizeEvidenceLinks(petition.freeze.evidenceLinks).length
                ? normalizeEvidenceLinks(petition.freeze.evidenceLinks)
                : evidenceLinks,
            }
          : petition.freeze;
        return {
          ...petition,
          evidenceSummary,
          evidenceLinks,
          versions,
          freeze,
        };
      });
      const discussions = (data.discussions || []).map((entry) => ({
        ...entry,
        factCheck: Boolean(entry.factCheck),
      }));
      return {
        ...data,
        petitions,
        discussions,
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
    role: session.role || 'person',
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
    title: stringOrEmpty(entry.title),
    content,
    authorHash: stringOrFallback(entry.authorHash, 'anonymous'),
    createdAt: entry.createdAt || entry.timestamp || new Date().toISOString(),
    parentId: entry.parentId || null,
    petitionId: entry.petitionId || null,
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
    return `person-${String(pidHash).slice(0, 8)}`;
  }
  if (fallbackId) {
    return `session-${String(fallbackId).slice(0, 8)}`;
  }
  return 'person';
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

function normalizeTopicKey(value) {
  const text = String(value || '').trim().toLowerCase();
  const slug = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'general';
}

function normalizeRevision(revision, petition, index, fallbackTime) {
  const createdAt = revision?.createdAt || petition.updatedAt || petition.createdAt || fallbackTime;
  const authorHash = revision?.authorHash || petition.updatedBy || petition.authorHash || 'anonymous';
  return {
    id: revision?.id || randomUUID(),
    petitionId: revision?.petitionId || petition.id || `legacy-petition-${index}`,
    title: revision?.title || petition.title || 'Untitled petition',
    summary: revision?.summary || petition.summary || '',
    body: revision?.body || petition.body || petition.text || '',
    evidenceSummary: revision?.evidenceSummary || petition.evidenceSummary || '',
    evidenceLinks: normalizeEvidenceLinks(revision?.evidenceLinks || petition.evidenceLinks || []),
    note: revision?.note || '',
    authorHash,
    authorHandle: revision?.authorHandle || null,
    topic: revision?.topic || petition.topic || 'general',
    topicId: revision?.topicId || petition.topicId || null,
    topicPath: Array.isArray(revision?.topicPath) ? revision.topicPath : petition.topicPath || [],
    createdAt,
  };
}

function parseTopicPath(rawTopic) {
  const text = stringOrEmpty(rawTopic);
  if (!text) return ['general'];
  const parts = text
    .split(/[>/]/)
    .map((entry) => stringOrEmpty(entry))
    .filter(Boolean);
  return parts.length ? parts : ['general'];
}

function normalizeEvidenceLinks(value) {
  if (!value) return [];
  const rawList = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  const links = [];
  const seen = new Set();
  for (const entry of rawList) {
    const trimmed = stringOrEmpty(entry);
    if (!trimmed) continue;
    if (!/^https?:\/\//i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    links.push(trimmed);
    if (links.length >= 8) break;
  }
  return links;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}
