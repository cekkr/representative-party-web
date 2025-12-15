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
