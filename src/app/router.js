import { URL } from 'node:url';

import { renderAdmin, updateAdmin, exportAuditLog } from '../interfaces/http/controllers/admin.js';
import { serveActor, serveOutbox, serveOutboxCollection, inbox } from '../interfaces/http/controllers/activitypub.js';
import { completeAuth, startAuth } from '../interfaces/http/controllers/auth.js';
import { handleGossip, exportLedger, listPeers, registerPeer } from '../interfaces/http/controllers/circle.js';
import { renderDiscussion, postDiscussion } from '../interfaces/http/controllers/discussion.js';
import {
  renderPetitions,
  submitPetition,
  castVote,
  updatePetitionStatus,
  signPetitionRoute,
  postPetitionComment,
} from '../interfaces/http/controllers/petitions.js';
import { renderForumRoute, postThread, postComment } from '../interfaces/http/controllers/forum.js';
import { renderGroups, createOrJoinGroup, setGroupDelegateRoute, updateGroupPolicyRoute } from '../interfaces/http/controllers/groups.js';
import { renderHealth } from '../interfaces/http/controllers/health.js';
import { renderHome } from '../interfaces/http/controllers/home.js';
import { servePublic } from '../interfaces/http/controllers/static.js';
import { getExtensions, toggleExtension } from '../interfaces/http/controllers/extensions.js';
import { renderNotifications, markNotificationsRead, updateNotificationPreferences } from '../interfaces/http/controllers/notifications.js';
import { renderDelegation, resolveConflict, updateDelegation } from '../interfaces/http/controllers/delegation.js';
import { exportVotes, gossipVotes } from '../interfaces/http/controllers/votes.js';
import {
  renderSocialFeed,
  postSocialMessage,
  followHandle,
  unfollowHandle,
  listRelationships,
} from '../interfaces/http/controllers/social.js';
import { renderTransactions, exportTransactions } from '../interfaces/http/controllers/transactions.js';
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
  { method: 'GET', path: '/petitions', action: renderPetitions },
  { method: 'POST', path: '/petitions', action: submitPetition },
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
  { method: 'GET', path: '/admin', action: renderAdmin },
  { method: 'POST', path: '/admin', action: updateAdmin },
  { method: 'GET', path: '/notifications', action: renderNotifications },
  { method: 'POST', path: '/notifications/read', action: markNotificationsRead },
  { method: 'POST', path: '/notifications/preferences', action: updateNotificationPreferences },
  { method: 'GET', path: '/delegation', action: renderDelegation },
  { method: 'POST', path: '/delegation', action: updateDelegation },
  { method: 'POST', path: '/delegation/conflict', action: resolveConflict },
  { method: 'GET', path: '/votes/ledger', action: exportVotes },
  { method: 'POST', path: '/votes/gossip', action: gossipVotes },
  { method: 'GET', path: '/extensions', action: getExtensions },
  { method: 'POST', path: '/extensions', action: toggleExtension },
  { method: 'GET', path: '/admin/audit', action: exportAuditLog },
  { method: 'GET', path: '/transactions', action: renderTransactions },
  { method: 'GET', path: '/transactions/export', action: exportTransactions },
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
  { method: 'POST', path: '/ap/inbox', action: inbox },
  {
    method: 'GET',
    prefix: '/public/',
    buildParams: (pathname) => ({ pathname }),
    action: ({ res, params }) => servePublic({ res, pathname: params.pathname }),
  },
];

export async function routeRequest(req, res, state) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsPartial = req.headers['x-requested-with'] === 'partial';
  const context = { req, res, url, state, wantsPartial };

  for (const route of routes) {
    if (route.method !== req.method) continue;
    if (route.path && url.pathname === route.path) {
      return route.action(context);
    }
    if (route.prefix && url.pathname.startsWith(route.prefix)) {
      const params = route.buildParams ? route.buildParams(url.pathname, url) : {};
      return route.action({ ...context, params });
    }
  }

  return sendNotFound(res);
}
