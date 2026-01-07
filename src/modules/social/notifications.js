import { createNotificationWithOutbound } from '../messaging/notifications.js';
import { sanitizeText } from '../../shared/utils/text.js';
import { extractMentions } from './posts.js';
import { findSessionByHandle, findSessionByHash } from '../identity/sessions.js';

const SNIPPET_LENGTH = 120;

export async function notifySocialParticipants(state, { post, author, targetSession }) {
  const recipients = new Map();
  const snippetSource = (post.content || post.reshare?.content || '').slice(0, SNIPPET_LENGTH);
  const snippet = snippetSource || '';

  if (post.visibility === 'direct' && targetSession?.pidHash) {
    recipients.set(targetSession.pidHash, {
      type: 'social_direct',
      message: `Direct message from ${author?.handle || 'someone'}: ${snippet}`,
      sessionId: targetSession.id,
      handle: targetSession.handle,
    });
  }

  const mentions = Array.isArray(post.mentions) ? post.mentions : extractMentions(post.content || '');
  for (const handle of mentions) {
    const session = findSessionByHandle(state, handle);
    if (!session || session.pidHash === author?.pidHash) continue;
    if (post.visibility === 'direct' && session.pidHash !== targetSession?.pidHash) continue;
    recipients.set(session.pidHash, {
      type: 'social_mention',
      message: `Mention from ${author?.handle || 'someone'}: ${snippet}`,
      sessionId: session.id,
      handle: session.handle,
    });
  }

  if (post.reshareOf && post.reshare?.authorHash) {
    const session = findSessionByHash(state, post.reshare.authorHash) || findSessionByHandle(state, post.reshare.authorHandle || '');
    if (session && session.pidHash !== author?.pidHash) {
      recipients.set(session.pidHash, {
        type: 'social_reshare',
        message: `Reshare by ${author?.handle || 'someone'}: ${snippet}`,
        sessionId: session.id,
        handle: session.handle,
      });
    }
  }

  for (const [recipientHash, payload] of recipients.entries()) {
    await createNotificationWithOutbound(state, {
      type: payload.type,
      recipientHash,
      message: payload.message,
    }, { sessionId: payload.sessionId, handle: payload.handle });
  }
}

export async function notifyMediaViewRequest(state, { media, viewer } = {}) {
  if (!media?.authorHash || !viewer?.pidHash) return;
  if (media.authorHash === viewer.pidHash) return;
  const authorSession = findSessionByHash(state, media.authorHash);
  if (!authorSession) return;

  const viewerLabel = sanitizeText(viewer.handle || viewer.pidHash || 'someone', 64) || 'someone';
  const kindLabel = media.kind === 'video' ? 'video' : 'photo';
  const nameSuffix = media.originalName ? ` (${sanitizeText(media.originalName, 80)})` : '';
  const message = `View request from ${viewerLabel} for your ${kindLabel}${nameSuffix}.`;

  await createNotificationWithOutbound(state, {
    type: 'social_media_view',
    recipientHash: authorSession.pidHash,
    message,
  }, { sessionId: authorSession.id, handle: authorSession.handle });
}
