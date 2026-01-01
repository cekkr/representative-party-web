const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public';

export function buildActivityPubCreateNote({
  content = 'Hello from ActivityPub',
  actor = 'https://remote.example/ap/actors/alice',
  activityId = 'https://remote.example/ap/activities/1',
  objectId = 'https://remote.example/ap/objects/1',
  publishedAt = '2024-01-02T00:00:00.000Z',
  policy = { id: 'party-circle-alpha', version: 1 },
} = {}) {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    id: activityId,
    actor,
    published: publishedAt,
    to: [PUBLIC_AUDIENCE],
    object: {
      type: 'Note',
      id: objectId,
      content,
      published: publishedAt,
      to: [PUBLIC_AUDIENCE],
      policy,
    },
  };
}
