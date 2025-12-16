export function createActor({ pidHash, baseUrl }) {
  const id = `${baseUrl}/ap/actors/${pidHash}`;
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Person',
    preferredUsername: pidHash.slice(0, 12),
    inbox: `${baseUrl}/ap/inbox`,
    outbox: `${baseUrl}/ap/outbox`,
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
