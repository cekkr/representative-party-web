// Centralize privilege resolution so posting/petition/vote checks share the same rules.
export function getPrivilegesForPerson(person, _state) {
  if (!person) {
    return {
      role: 'guest',
      sessionId: null,
      canPost: false,
      canModerate: false,
      canDelegate: false,
      canPetition: false,
      canVote: false,
      banned: false,
    };
  }

  const role = person.role || 'person';
  const banned = Boolean(person.banned);
  const canModerate = role === 'admin' || role === 'moderator';
  const canVote = !banned && role !== 'guest';
  const canPetition = !banned && role !== 'guest';
  const canPost = !banned && role !== 'guest';

  return {
    role,
    sessionId: person.sessionId || null,
    banned,
    canPost,
    canModerate,
    canDelegate: !banned,
    canPetition,
    canVote,
  };
}
