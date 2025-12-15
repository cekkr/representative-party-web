// Centralize privilege resolution so posting/petition/vote checks share the same rules.
export function getPrivilegesForCitizen(citizen, _state) {
  if (!citizen) {
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

  const role = citizen.role || 'citizen';
  const banned = Boolean(citizen.banned);
  const canModerate = role === 'admin' || role === 'moderator';
  const canVote = !banned && role !== 'guest';
  const canPetition = !banned && role !== 'guest';
  const canPost = !banned && role !== 'guest';

  return {
    role,
    sessionId: citizen.sessionId || null,
    banned,
    canPost,
    canModerate,
    canDelegate: !banned,
    canPetition,
    canVote,
  };
}
