import { URL } from 'node:url';

import { renderAdmin, updateAdmin, exportAuditLog } from '../modules/admin/http/admin.js';
import { serveActor, serveOutbox, serveOutboxCollection, serveObject, inbox } from '../interfaces/http/controllers/activitypub.js';
import { completeAuth, startAuth } from '../modules/auth/http/auth.js';
import { handleGossip, exportLedger, listPeers, registerPeer } from '../interfaces/http/controllers/circle.js';
import { renderDiscussion, postDiscussion } from '../modules/discussion/http/discussion.js';
import {
  renderPetitions,
  submitPetition,
  updatePetitionDraft,
  castVote,
  updatePetitionStatus,
  signPetitionRoute,
  postPetitionComment,
} from '../modules/petitions/http/petitions.js';
import { renderForumRoute, postThread, postComment } from '../modules/forum/http/forum.js';
import { renderGroups, createOrJoinGroup, setGroupDelegateRoute, updateGroupPolicyRoute } from '../modules/groups/http/groups.js';
import { renderGovernance } from '../modules/governance/http/governance.js';
import { renderHealth } from '../interfaces/http/controllers/health.js';
import { renderHome } from '../modules/home/http/home.js';
import { servePublic } from '../interfaces/http/controllers/static.js';
import { getExtensions, toggleExtension } from '../interfaces/http/controllers/extensions.js';
import { renderNotifications, markNotificationsRead, updateNotificationPreferences } from '../modules/notifications/http/notifications.js';
import { renderProfile, updateProfileAttributes } from '../modules/profile/http/profile.js';
import { renderDelegation, resolveConflict, updateDelegation } from '../modules/delegation/http/delegation.js';
import { renderDelegateDirectory, renderDelegateProfile } from '../modules/delegates/http/delegates.js';
import { exportVotes, gossipVotes } from '../interfaces/http/controllers/votes.js';
import {
  renderSocialFeed,
  postSocialMessage,
  followHandle,
  unfollowHandle,
  listRelationships,
  serveSocialMedia,
  reportSocialMedia,
} from '../modules/social/http/social.js';
import { renderTransactions, exportTransactions, exportTransactionsLedger, gossipTransactions } from '../interfaces/http/controllers/transactions.js';
import { sendNotFound } from '../shared/utils/http.js';

const routes = [
  { method: 'GET', path: '/', action: renderHome },
  { method: 'GET', path: '/health', action: renderHealth },
  { method: 'GET', path: '/auth/eudi', action: startAuth },
  { method: 'GET', path: '/auth/callback', action: completeAuth },
  { method: 'GET', path: '/discussion', action: renderDiscussion },
  { method: 'POST', path: '/discussion', action: postDiscussion },
  { method: 'GET', path: '/forum', action: renderForumRoute },
  { method: 'POST', path: '/forum', action: postThread },
  { method: 'POST', path: '/forum/comment', action: postComment },
  { method: 'GET', path: '/governance', action: renderGovernance },
  { method: 'GET', path: '/petitions', action: renderPetitions },
  { method: 'POST', path: '/petitions', action: submitPetition },
  { method: 'POST', path: '/petitions/update', action: updatePetitionDraft },
  { method: 'POST', path: '/petitions/sign', action: signPetitionRoute },
  { method: 'POST', path: '/petitions/comment', action: postPetitionComment },
  { method: 'POST', path: '/petitions/vote', action: castVote },
  { method: 'POST', path: '/petitions/status', action: updatePetitionStatus },
  { method: 'GET', path: '/groups', action: renderGroups },
  { method: 'POST', path: '/groups', action: createOrJoinGroup },
  { method: 'POST', path: '/groups/delegate', action: setGroupDelegateRoute },
  { method: 'POST', path: '/groups/policy', action: updateGroupPolicyRoute },
  { method: 'POST', path: '/circle/gossip', action: handleGossip },
  { method: 'GET', path: '/circle/ledger', action: exportLedger },
  { method: 'GET', path: '/circle/peers', action: listPeers },
  { method: 'POST', path: '/circle/peers', action: registerPeer },
  { method: 'GET', path: '/social/feed', action: renderSocialFeed },
  { method: 'POST', path: '/social/post', action: postSocialMessage },
  { method: 'POST', path: '/social/reply', action: postSocialMessage },
  { method: 'POST', path: '/social/follow', action: followHandle },
  { method: 'POST', path: '/social/unfollow', action: unfollowHandle },
  { method: 'GET', path: '/social/relationships', action: listRelationships },
  { method: 'POST', path: '/social/media/report', action: reportSocialMedia },
  {
    method: 'GET',
    prefix: '/social/media/',
    buildParams: (pathname) => {
      const segments = pathname.split('/').filter(Boolean);
      return { mediaId: segments[segments.length - 1] || '' };
    },
    action: ({ req, res, state, params }) => serveSocialMedia({ req, res, state, params }),
  },
  { method: 'GET', path: '/admin', action: renderAdmin },
  { method: 'POST', path: '/admin', action: updateAdmin },
  { method: 'GET', path: '/notifications', action: renderNotifications },
  { method: 'POST', path: '/notifications/read', action: markNotificationsRead },
  { method: 'POST', path: '/notifications/preferences', action: updateNotificationPreferences },
  { method: 'GET', path: '/profile', action: renderProfile },
  { method: 'POST', path: '/profile', action: updateProfileAttributes },
  { method: 'GET', path: '/delegation', action: renderDelegation },
  { method: 'POST', path: '/delegation', action: updateDelegation },
  { method: 'POST', path: '/delegation/conflict', action: resolveConflict },
  { method: 'GET', path: '/delegates', action: renderDelegateDirectory },
  {
    method: 'GET',
    prefix: '/delegates/',
    buildParams: (pathname) => {
      const segments = pathname.split('/').filter(Boolean);
      return { hash: segments[segments.length - 1] || '' };
    },
    action: ({ req, res, state, wantsPartial, params }) =>
      renderDelegateProfile({ req, res, state, wantsPartial, params }),
  },
  { method: 'GET', path: '/votes/ledger', action: exportVotes },
  { method: 'POST', path: '/votes/gossip', action: gossipVotes },
  { method: 'GET', path: '/extensions', action: getExtensions },
  { method: 'POST', path: '/extensions', action: toggleExtension },
  { method: 'GET', path: '/admin/audit', action: exportAuditLog },
  { method: 'GET', path: '/transactions', action: renderTransactions },
  { method: 'GET', path: '/transactions/export', action: exportTransactions },
  { method: 'GET', path: '/transactions/ledger', action: exportTransactionsLedger },
  { method: 'POST', path: '/transactions/gossip', action: gossipTransactions },
  {
    method: 'GET',
    prefix: '/ap/actors/',
    buildParams: (pathname) => {
      const segments = pathname.split('/').filter(Boolean);
      if (!segments.length) return { hash: '', outbox: false };
      const last = segments[segments.length - 1];
      if (last === 'outbox') {
        return { hash: segments[segments.length - 2] || '', outbox: true };
      }
      return { hash: last, outbox: false };
    },
    action: ({ req, res, state, params }) => {
      if (params.outbox) {
        return serveOutbox({ req, res, state, hash: params.hash });
      }
      return serveActor({ res, state, hash: params.hash });
    },
  },
  { method: 'GET', path: '/ap/outbox', action: serveOutboxCollection },
  {
    method: 'GET',
    prefix: '/ap/objects/',
    buildParams: (pathname) => {
      const segments = pathname.split('/').filter(Boolean);
      return { id: segments[segments.length - 1] || '' };
    },
    action: ({ req, res, state, params }) => serveObject({ req, res, state, id: params.id }),
  },
  { method: 'POST', path: '/ap/inbox', action: inbox },
  {
    method: 'GET',
    prefix: '/public/',
    buildParams: (pathname) => ({ pathname }),
    action: ({ res, params }) => servePublic({ res, pathname: params.pathname }),
  },
];

const routesByMethod = buildRouteIndex(routes);

export async function routeRequest(req, res, state) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';
  const context = { req, res, url, state, wantsPartial };
  const methodRoutes = routesByMethod.get(req.method);
  if (!methodRoutes) {
    return sendNotFound(res);
  }
  const pathname = url.pathname;
  const exactRoute = methodRoutes.exact.get(pathname);
  if (exactRoute) {
    return exactRoute.action(context);
  }

  for (const route of methodRoutes.prefixes) {
    if (pathname.startsWith(route.prefix)) {
      const params = route.buildParams ? route.buildParams(pathname, url) : {};
      return route.action({ ...context, params });
    }
  }

  return sendNotFound(res);
}

function buildRouteIndex(entries = []) {
  const index = new Map();
  for (const route of entries) {
    if (!route?.method) continue;
    let bucket = index.get(route.method);
    if (!bucket) {
      bucket = { exact: new Map(), prefixes: [] };
      index.set(route.method, bucket);
    }
    if (route.path) {
      bucket.exact.set(route.path, route);
    } else if (route.prefix) {
      bucket.prefixes.push(route);
    }
  }
  return index;
}
