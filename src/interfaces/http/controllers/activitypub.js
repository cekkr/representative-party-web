import { sendJson, sendNotFound } from '../../../shared/utils/http.js';
import { deriveBaseUrl, readRequestBody } from '../../../shared/utils/request.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { getEffectivePolicy } from '../../../modules/circle/policy.js';
import { persistSocialPosts } from '../../../infra/persistence/storage.js';
import { createSocialNote, wrapCreateActivity, buildInboundSocialPost } from '../../../modules/federation/activitypub.js';
import { filterVisibleEntries } from '../../../modules/federation/replication.js';
import { logTransaction } from '../../../modules/transactions/registry.js';
import { notifySocialParticipants } from '../../../modules/social/notifications.js';
import { sendModuleDisabledJson } from '../views/moduleGate.js';

export function serveActor({ res, state, hash }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const actor = state.actors.get(hash);
  if (!actor) return sendNotFound(res);
  return sendJson(res, 200, actor);
}

export async function inbox({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const rawBody = await readRequestBody(req);
  const body = normalizeBody(rawBody);
  const baseUrl = deriveBaseUrl(req);
  const policy = getEffectivePolicy(state);
  const result = buildInboundSocialPost({ state, payload: body, baseUrl, policy });
  if (result.error) {
    return sendJson(res, result.statusCode || 400, {
      error: result.error,
      message: result.detail || 'Inbound ActivityPub payload rejected.',
    });
  }

  const { entry } = result;
  if (!entry) {
    return sendJson(res, 400, { error: 'invalid_payload', message: 'Inbound ActivityPub payload missing content.' });
  }
  if (isDuplicateInbound(state, entry.activityPub)) {
    return sendJson(res, 202, { status: 'duplicate', objectId: entry.activityPub?.objectId || null });
  }

  state.socialPosts = [entry, ...(state.socialPosts || [])];
  await persistSocialPosts(state);
  await logTransaction(state, {
    type: 'activitypub_inbox',
    actorHash: entry.authorHash,
    payload: {
      objectId: entry.activityPub?.objectId || null,
      activityId: entry.activityPub?.activityId || null,
      actorId: entry.activityPub?.actorId || null,
      visibility: entry.visibility || 'public',
    },
    validationStatus: entry.validationStatus,
  });
  const targetSession = entry.targetHash ? findSessionByHash(state, entry.targetHash) : null;
  try {
    await notifySocialParticipants(state, {
      post: entry,
      author: { handle: entry.authorHandle, pidHash: entry.authorHash },
      targetSession,
    });
  } catch (error) {
    console.warn('[activitypub] notification dispatch failed', error);
  }

  return sendJson(res, 202, {
    status: 'accepted',
    id: entry.id,
    objectId: entry.activityPub?.objectId || null,
    activityId: entry.activityPub?.activityId || null,
    validationStatus: entry.validationStatus,
  });
}

export function serveOutboxCollection({ req, res, state }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const baseUrl = deriveBaseUrl(req);
  const posts = filterVisibleEntries(state.socialPosts || [], state).filter((post) => post.visibility !== 'direct');
  const orderedItems = buildOutboxItems(posts, baseUrl);
  return sendJson(res, 200, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/outbox`,
    type: 'OrderedCollection',
    totalItems: orderedItems.length,
    orderedItems,
  });
}

export function serveOutbox({ req, res, state, hash }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  const actor = state.actors.get(hash);
  if (!actor) return sendNotFound(res);
  const baseUrl = deriveBaseUrl(req);
  const posts = filterVisibleEntries(state.socialPosts || [], state).filter(
    (post) => post.authorHash === hash && post.visibility !== 'direct',
  );
  const orderedItems = buildOutboxItems(posts, baseUrl);

  return sendJson(res, 200, {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: `${baseUrl}/ap/actors/${hash}/outbox`,
    type: 'OrderedCollection',
    totalItems: orderedItems.length,
    orderedItems,
  });
}

export function serveObject({ req, res, state, id }) {
  if (!isModuleEnabled(state, 'federation')) {
    return sendModuleDisabledJson({ res, moduleKey: 'federation' });
  }
  if (!id) return sendNotFound(res);
  const post = filterVisibleEntries(state.socialPosts || [], state).find((entry) => entry.id === id);
  if (!post || post.visibility === 'direct' || post.activityPub?.inbound) {
    return sendNotFound(res);
  }
  const baseUrl = deriveBaseUrl(req);
  const note = post.activityPub?.note || createSocialNote({ post, baseUrl });
  if (!note) return sendNotFound(res);
  return sendJson(res, 200, note);
}

function buildOutboxItems(posts, baseUrl) {
  return posts
    .map((post) => {
      const note = post.activityPub?.note || createSocialNote({ post, baseUrl });
      if (!note) return null;
      return post.activityPub?.activity || wrapCreateActivity({ note, baseUrl });
    })
    .filter(Boolean);
}

function normalizeBody(body) {
  if (body && typeof body === 'object' && !body.raw) {
    return body;
  }
  if (body && typeof body.raw === 'string') {
    try {
      return JSON.parse(body.raw);
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function isDuplicateInbound(state, activityPub = {}) {
  const objectId = activityPub?.objectId;
  const activityId = activityPub?.activityId;
  if (!objectId && !activityId) return false;
  return (state.socialPosts || []).some((post) => {
    const meta = post.activityPub || {};
    if (objectId && meta.objectId === objectId) return true;
    if (activityId && meta.activityId === activityId) return true;
    return false;
  });
}

function findSessionByHash(state, pidHash) {
  if (!pidHash || !state?.sessions) return null;
  for (const session of state.sessions.values()) {
    if (session.pidHash === pidHash) return session;
  }
  return null;
}
