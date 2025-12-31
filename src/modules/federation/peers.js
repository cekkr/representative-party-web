export function normalizePeerUrl(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (!/^https?:\/\//i.test(trimmed)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(trimmed);
    const isHostLike = /^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(trimmed);
    if (!isLocal && (!isHostLike || !trimmed.includes('.'))) {
      return null;
    }
    normalized = `${isLocal ? 'http' : 'https'}://${trimmed}`;
  }
  return normalized.replace(/\/+$/, '');
}

export function collectGossipPeers(state) {
  const peers = new Set();
  const rawPeers = [];
  if (state?.peers) {
    rawPeers.push(...state.peers);
  }
  if (state?.settings?.preferredPeer) {
    rawPeers.push(state.settings.preferredPeer);
  }
  for (const peer of rawPeers) {
    const normalized = normalizePeerUrl(peer);
    if (normalized) peers.add(normalized);
  }
  return [...peers];
}
