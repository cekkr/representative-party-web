import { createNotification } from '../messaging/notifications.js';
import { findSessionByHandle } from './followGraph.js';

const SNIPPET_LENGTH = 120;

export async function notifySocialParticipants(state, { post, author, targetSession }) {
  const recipients = new Map();
  const snippet = (post.content || '').slice(0, SNIPPET_LENGTH);

  if (post.visibility === 'direct' && targetSession?.pidHash) {
    recipients.set(targetSession.pidHash, {
      type: 'social_direct',
      message: `Direct message from ${author?.handle || 'someone'}: ${snippet}`,
    });
  }

  const mentions = extractMentions(post.content || '');
  for (const handle of mentions) {
    const session = findSessionByHandle(state, handle);
    if (!session || session.pidHash === author?.pidHash) continue;
    if (post.visibility === 'direct' && session.pidHash !== targetSession?.pidHash) continue;
    recipients.set(session.pidHash, {
      type: 'social_mention',
      message: `Mention from ${author?.handle || 'someone'}: ${snippet}`,
    });
  }

  for (const [recipientHash, payload] of recipients.entries()) {
    await createNotification(state, {
      type: payload.type,
      recipientHash,
      message: payload.message,
    });
  }
}

function extractMentions(content = '') {
  const regex = /@([a-zA-Z0-9._-]{2,64})/g;
  const handles = new Set();
  let match;
  while ((match = regex.exec(content))) {
    handles.add(match[1]);
  }
  return [...handles];
}
