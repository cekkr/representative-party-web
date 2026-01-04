import { createHash } from 'node:crypto';

import { sanitizeText } from '../../shared/utils/text.js';
import { findSessionByHash } from '../identity/sessions.js';
import { decideStatus, getReplicationProfile, stampLocalEntry } from './replication.js';

const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public';
const MAX_NOTE_LENGTH = 560;
const MENTION_REGEX = /@([a-zA-Z0-9._-]{2,64})/g;
const TAG_REGEX = /#([a-zA-Z0-9_-]{2,48})/g;

export function createActor({ pidHash, baseUrl }) {
  const id = `${baseUrl}/ap/actors/${pidHash}`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Person',
    preferredUsername: pidHash.slice(0, 12),
    inbox: `${baseUrl}/ap/inbox`,
    outbox: `${baseUrl}/ap/actors/${pidHash}/outbox`,
    hash: pidHash,
    published: new Date().toISOString(),
  };
}

export function createSocialNote({ post, baseUrl }) {
  if (!post || !post.authorHash) return null;
  const actorId = `${baseUrl}/ap/actors/${post.authorHash}`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Note',
    id: `${baseUrl}/ap/objects/${post.id}`,
    attributedTo: actorId,
    content: post.content,
    published: post.createdAt || new Date().toISOString(),
    to: post.visibility === 'direct' ? [] : ['https://www.w3.org/ns/activitystreams#Public'],
    bto: post.visibility === 'direct' && post.targetHash ? [`${baseUrl}/ap/actors/${post.targetHash}`] : [],
    inReplyTo: post.replyTo ? `${baseUrl}/ap/objects/${post.replyTo}` : null,
    policy: {
      id: post.policyId || 'party-circle-alpha',
      version: post.policyVersion || 1,
    },
  };
}

export function wrapCreateActivity({ note, baseUrl }) {
  if (!note) return null;
  const actorId = note.attributedTo || `${baseUrl}/ap/actors/${note.actorHash || 'unknown'}`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    id: `${note.id}#create`,
    actor: actorId,
    object: note,
    published: note.published || new Date().toISOString(),
  };
}

export function buildInboundSocialPost({ state, payload, baseUrl, policy } = {}) {
  const normalized = normalizeInboundPayload(payload);
  if (!normalized) {
    return { error: 'unsupported_activity', statusCode: 400 };
  }
  const policyCheck = validatePolicy(policy, normalized.policy);
  if (!policyCheck.ok) {
    return { error: policyCheck.error, statusCode: 409, detail: policyCheck.detail };
  }
  const profile = getReplicationProfile(state);
  const decision = decideStatus(profile, 'preview');
  if (decision.status === 'rejected') {
    return { error: 'preview_blocked', statusCode: 202 };
  }

  const content = sanitizeText(normalized.content || '', MAX_NOTE_LENGTH);
  if (!content) {
    return { error: 'missing_content', statusCode: 400 };
  }

  const actorId = normalized.actorId || '';
  const authorHandle = deriveActorHandle(actorId) || 'remote';
  const authorHash = hashActorId(actorId || normalized.objectId || content);
  const issuer = deriveIssuer(actorId);
  const visibility = normalized.isPublic ? 'public' : 'direct';
  const { targetHash, targetHandle } = resolveLocalTarget(normalized.recipients, baseUrl, state);
  const replyTo = resolveReplyTo(normalized.inReplyTo, baseUrl);
  if (visibility === 'direct' && !targetHash) {
    return {
      error: 'direct_not_local',
      statusCode: 202,
      detail: 'Direct ActivityPub note not addressed to a local actor.',
    };
  }

  const entry = stampLocalEntry(state, {
    id: buildInboundId(normalized.objectId || normalized.activityId || content),
    authorHash,
    authorHandle,
    content,
    createdAt: normalized.publishedAt || new Date().toISOString(),
    replyTo,
    mentions: extractMentions(content),
    tags: extractTags(content),
    visibility,
    targetHash: visibility === 'direct' ? targetHash : '',
    targetHandle: visibility === 'direct' ? targetHandle : '',
    policyId: policy?.id || normalized.policy?.id || 'unknown',
    policyVersion: policy?.version || normalized.policy?.version || 0,
    validationStatus: decision.status === 'preview' ? 'preview' : 'validated',
    issuer,
    provenance: {
      issuer,
      mode: profile.mode,
      adapter: profile.adapter,
    },
    activityPub: {
      inbound: true,
      activityId: normalized.activityId || null,
      objectId: normalized.objectId || null,
      actorId: actorId || null,
      type: normalized.type || 'Note',
    },
  });

  return { entry, normalized };
}

function normalizeInboundPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = normalizeType(payload.type);
  if (type === 'Create' || type === 'Announce') {
    const object = typeof payload.object === 'object' ? payload.object : null;
    const objectType = normalizeType(object?.type);
    if (!object || (objectType && !isSupportedObjectType(objectType))) return null;
    return normalizeNote({
      activityType: type,
      activityId: payload.id,
      actorId: normalizeActor(payload.actor),
      object,
      objectType,
      publishedAt: payload.published || object.published,
      inReplyTo: object.inReplyTo,
      policy: object.policy || payload.policy,
      recipients: collectRecipients(payload, object),
    });
  }
  if (type && isSupportedObjectType(type)) {
    return normalizeNote({
      activityType: 'Note',
      activityId: payload.id,
      actorId: normalizeActor(payload.attributedTo),
      object: payload,
      objectType: type,
      publishedAt: payload.published,
      inReplyTo: payload.inReplyTo,
      policy: payload.policy,
      recipients: collectRecipients(payload),
    });
  }
  return null;
}

function normalizeNote({
  activityType,
  activityId,
  actorId,
  object,
  objectType,
  publishedAt,
  inReplyTo,
  policy,
  recipients,
}) {
  const content = resolveContent(object);
  const objectId = object?.id || '';
  const normalizedRecipients = normalizeRecipients(recipients);
  return {
    type: objectType || activityType,
    activityId: activityId || '',
    actorId: actorId || '',
    objectId: objectId || '',
    content,
    publishedAt: publishedAt || null,
    inReplyTo: inReplyTo || null,
    policy: policy || null,
    recipients: normalizedRecipients,
    isPublic: normalizedRecipients.public,
  };
}

function resolveContent(object) {
  if (!object || typeof object !== 'object') return '';
  return object.content || object.summary || object.name || '';
}

function normalizeType(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string') || '';
  }
  return String(value);
}

function normalizeActor(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.id || value.url || '';
  return '';
}

function isSupportedObjectType(type) {
  return type === 'Note' || type === 'Article';
}

function collectRecipients(activity = {}, object = {}) {
  return {
    to: activity.to || object.to || [],
    cc: activity.cc || object.cc || [],
    bto: activity.bto || object.bto || [],
    bcc: activity.bcc || object.bcc || [],
  };
}

function normalizeRecipients(recipients = {}) {
  const to = toArray(recipients.to);
  const cc = toArray(recipients.cc);
  const bto = toArray(recipients.bto);
  const bcc = toArray(recipients.bcc);
  const all = [...to, ...cc, ...bto, ...bcc].filter(Boolean);
  const publicMatch = all.some((entry) => String(entry).includes(PUBLIC_AUDIENCE));
  return {
    to,
    cc,
    bto,
    bcc,
    all,
    public: publicMatch,
  };
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveLocalTarget(recipients, baseUrl, state) {
  if (!recipients || !baseUrl) return { targetHash: '', targetHandle: '' };
  const prefix = `${baseUrl.replace(/\/+$/, '')}/ap/actors/`;
  const match = recipients.all.find((entry) => typeof entry === 'string' && entry.startsWith(prefix));
  if (!match) return { targetHash: '', targetHandle: '' };
  const targetHash = match.slice(prefix.length);
  const targetHandle = resolveSessionHandle(state, targetHash);
  return { targetHash, targetHandle: targetHandle || targetHash };
}

function resolveReplyTo(inReplyTo, baseUrl) {
  if (!inReplyTo) return null;
  if (!baseUrl || typeof inReplyTo !== 'string') return sanitizeText(String(inReplyTo), 120);
  const prefix = `${baseUrl.replace(/\/+$/, '')}/ap/objects/`;
  if (inReplyTo.startsWith(prefix)) {
    return inReplyTo.slice(prefix.length);
  }
  return sanitizeText(inReplyTo, 120);
}

function hashActorId(value) {
  if (!value) return 'remote';
  return createHash('sha256').update(String(value)).digest('hex');
}

function buildInboundId(seed) {
  if (!seed) return `ap_${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 16)}`;
  const hash = createHash('sha256').update(String(seed)).digest('hex').slice(0, 16);
  return `ap_${hash}`;
}

function deriveActorHandle(actorId) {
  if (!actorId) return '';
  try {
    const url = new URL(actorId);
    const parts = url.pathname.split('/').filter(Boolean);
    const handle = parts.pop();
    if (!handle) return url.host;
    return sanitizeText(`${handle}@${url.host}`, 80);
  } catch (_error) {
    return sanitizeText(actorId, 80);
  }
}

function deriveIssuer(actorId) {
  if (!actorId) return 'remote';
  try {
    const url = new URL(actorId);
    return sanitizeText(url.host || actorId, 120);
  } catch (_error) {
    return sanitizeText(actorId, 120);
  }
}

function resolveSessionHandle(state, pidHash) {
  if (!pidHash) return '';
  const session = findSessionByHash(state, pidHash);
  return session?.handle || '';
}

function extractMentions(content = '') {
  const handles = new Set();
  MENTION_REGEX.lastIndex = 0;
  let match;
  while ((match = MENTION_REGEX.exec(content))) {
    handles.add(match[1].toLowerCase());
  }
  return [...handles];
}

function extractTags(content = '') {
  const tags = new Set();
  TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = TAG_REGEX.exec(content))) {
    tags.add(match[1].toLowerCase());
  }
  return [...tags];
}

function validatePolicy(localPolicy, envelopePolicy) {
  if (!envelopePolicy || !envelopePolicy.id) {
    return { ok: true };
  }
  if (envelopePolicy.id !== localPolicy.id) {
    return { ok: false, error: 'policy_mismatch', detail: 'Envelope policy id does not match.' };
  }
  if (Number(envelopePolicy.version) !== Number(localPolicy.version)) {
    return { ok: false, error: 'policy_version_mismatch', detail: 'Envelope policy version does not match.' };
  }
  return { ok: true };
}
