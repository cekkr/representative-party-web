import { sendJson, sendNotFound } from '../../../shared/utils/http.js';
import { deriveBaseUrl, readRequestBody } from '../../../shared/utils/request.js';
import { isModuleEnabled } from '../../../modules/circle/modules.js';
import { createSocialNote, wrapCreateActivity } from '../../../modules/federation/activitypub.js';
import { filterVisibleEntries } from '../../../modules/federation/replication.js';
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
  const body = await readRequestBody(req);
  return sendJson(res, 202, { status: 'accepted', received: body });
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

function buildOutboxItems(posts, baseUrl) {
  return posts
    .map((post) => {
      const note = post.activityPub?.note || createSocialNote({ post, baseUrl });
      if (!note) return null;
      return post.activityPub?.activity || wrapCreateActivity({ note, baseUrl });
    })
    .filter(Boolean);
}
