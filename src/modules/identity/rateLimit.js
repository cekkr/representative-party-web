const DEFAULT_RATE_LIMITS = {
  discussion_post: { windowMs: 60_000, max: 6 },
  forum_thread: { windowMs: 300_000, max: 3 },
  forum_comment: { windowMs: 60_000, max: 10 },
  social_post: { windowMs: 60_000, max: 12 },
  petition_draft: { windowMs: 600_000, max: 2 },
  petition_comment: { windowMs: 60_000, max: 6 },
};

const RATE_LIMIT_LABELS = {
  discussion_post: 'discussion posts',
  forum_thread: 'forum threads',
  forum_comment: 'forum comments',
  social_post: 'social posts',
  petition_draft: 'petition drafts',
  petition_comment: 'petition comments',
};

export function resolveRateLimitActor({ person, req } = {}) {
  if (person?.pidHash) return `pid:${person.pidHash}`;
  if (person?.sessionId) return `session:${person.sessionId}`;
  const forwarded = req?.headers?.['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : '';
  const socketIp = req?.socket?.remoteAddress;
  if (ip) return `ip:${ip}`;
  if (socketIp) return `ip:${socketIp}`;
  return null;
}

export function consumeRateLimit(state, { key, actorKey, now = Date.now() } = {}) {
  const limits = resolveRateLimits(state);
  const limit = limits[key];
  if (!limit || !actorKey) return { allowed: true };
  if (!state.rateLimits) {
    state.rateLimits = new Map();
  }

  const bucketKey = `${key}:${actorKey}`;
  const history = state.rateLimits.get(bucketKey) || [];
  const windowStart = now - limit.windowMs;
  const recent = history.filter((timestamp) => timestamp > windowStart);
  if (recent.length >= limit.max) {
    const resetAt = recent[0] + limit.windowMs;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    state.rateLimits.set(bucketKey, recent);
    return {
      allowed: false,
      limit: limit.max,
      remaining: 0,
      resetAt,
      retryAfter,
      message: buildMessage(key, retryAfter),
    };
  }

  recent.push(now);
  state.rateLimits.set(bucketKey, recent);
  const resetAt = recent[0] + limit.windowMs;
  return {
    allowed: true,
    limit: limit.max,
    remaining: Math.max(0, limit.max - recent.length),
    resetAt,
  };
}

export function resolveRateLimits(state) {
  const overrides = state?.settings?.rateLimits || {};
  const merged = { ...DEFAULT_RATE_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = normalizeLimit(value);
    if (normalized) merged[key] = normalized;
  }
  return merged;
}

export function normalizeLimit(value) {
  if (!value || typeof value !== 'object') return null;
  const max = Number(value.max);
  const windowMs = Number(
    value.windowMs ??
      value.window ??
      (Number.isFinite(Number(value.windowSeconds)) ? Number(value.windowSeconds) * 1000 : NaN),
  );
  if (!Number.isFinite(max) || max <= 0) return null;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;
  return { max, windowMs };
}

function buildMessage(key, retryAfter) {
  const label = RATE_LIMIT_LABELS[key] || 'actions';
  return `Rate limit: too many ${label}. Try again in ${retryAfter}s.`;
}

export { DEFAULT_RATE_LIMITS };
