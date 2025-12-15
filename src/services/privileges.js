// Centralize privilege resolution so posting/petition/vote checks share the same rules.
export function getPrivilegesForCitizen(citizen, _state) {
  if (!citizen) {
    return {
      role: 'guest',
      sessionId: null,
      canPost: false,
      canModerate: false,
      canDelegate: false,
      banned: false,
    };
  }

  const role = citizen.role || 'citizen';
  const banned = Boolean(citizen.banned);
  const canModerate = role === 'admin' || role === 'moderator';

  return {
    role,
    sessionId: citizen.sessionId || null,
    banned,
    canPost: !banned,
    canModerate,
    canDelegate: !banned,
  };
}
