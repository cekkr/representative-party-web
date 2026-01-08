import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { MEDIA, PATHS } from '../../config.js';
import { getEffectivePolicy } from '../circle/policy.js';
import { stampLocalEntry } from '../federation/replication.js';
import { sanitizeText } from '../../shared/utils/text.js';

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

const EXTENSION_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
};

export function findMedia(state, mediaId) {
  if (!mediaId) return null;
  return (state.socialMedia || []).find((entry) => entry.id === mediaId) || null;
}

export function listMediaForPost(state, post) {
  const ids = Array.isArray(post?.mediaIds) ? post.mediaIds : [];
  return ids.map((id) => findMedia(state, id)).filter(Boolean);
}

export function hasBlockedMedia(state, post) {
  const attachments = listMediaForPost(state, post);
  return attachments.some((media) => media.status === 'blocked');
}

export async function createMedia(state, { postId, file, person }) {
  if (!file || (!file.data && !file.tempPath) || !file.filename) {
    const error = new Error('missing_media');
    error.code = 'missing_media';
    throw error;
  }
  let tempPath = file.tempPath || '';
  try {
    let size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) {
      if (file.data) {
        size = file.data.length;
      } else if (tempPath) {
        const info = await stat(tempPath);
        size = info.size;
      }
    }
    if (!size) {
      const error = new Error('empty_media');
      error.code = 'empty_media';
      throw error;
    }
    if (Number.isFinite(MEDIA.maxBytes) && size > MEDIA.maxBytes) {
      const error = new Error('media_too_large');
      error.code = 'media_too_large';
      error.maxBytes = MEDIA.maxBytes;
      throw error;
    }

    const contentType = String(file.contentType || '').toLowerCase();
    if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
      const error = new Error('unsupported_media');
      error.code = 'unsupported_media';
      throw error;
    }

    const kind = contentType.startsWith('image/') ? 'image' : 'video';
    const safeName = normalizeFilename(file.filename);
    const extension = resolveExtension(safeName, contentType);
    const id = randomUUID();
    const storedName = `${id}${extension}`;
    await mkdir(PATHS.MEDIA_ROOT, { recursive: true });
    const storedPath = join(PATHS.MEDIA_ROOT, storedName);
    if (tempPath) {
      await moveTempFile(tempPath, storedPath);
      tempPath = '';
    } else {
      await writeFile(storedPath, file.data);
    }

    const policy = getEffectivePolicy(state);
    const now = new Date().toISOString();
    const entry = stampLocalEntry(state, {
      id,
      postId: postId || '',
      authorHash: person?.pidHash || 'anonymous',
      authorHandle: person?.handle || 'guest',
      originalName: sanitizeText(safeName, 160),
      storedName,
      contentType,
      size,
      kind,
      status: 'locked',
      reportCount: 0,
      reporters: [],
      viewRequests: 0,
      createdAt: now,
      updatedAt: now,
      blockedAt: null,
      blockedReason: '',
      policyId: policy.id,
      policyVersion: policy.version,
    });

    upsertMedia(state, entry);
    return entry;
  } catch (error) {
    if (tempPath) {
      await safeUnlink(tempPath);
    }
    throw error;
  }
}

export function recordMediaViewRequest(state, media, { actorHash } = {}) {
  if (!media) return null;
  const now = new Date().toISOString();
  const entry = {
    ...media,
    viewRequests: (media.viewRequests || 0) + 1,
    lastViewRequestAt: now,
    updatedAt: now,
  };
  if (actorHash) {
    const viewers = new Set(media.viewers || []);
    viewers.add(actorHash);
    entry.viewers = [...viewers];
  }
  upsertMedia(state, entry);
  return entry;
}

export function reportMedia(state, media, { reporterHash, threshold = MEDIA.reportThreshold } = {}) {
  if (!media) return null;
  const reporters = new Set(media.reporters || []);
  const now = new Date().toISOString();
  if (reporterHash) {
    reporters.add(reporterHash);
  }
  const reportCount = reporters.size;
  const shouldBlock = Number.isFinite(threshold) && threshold > 0 ? reportCount >= threshold : false;
  const status = shouldBlock ? 'blocked' : media.status || 'locked';
  const entry = {
    ...media,
    reporters: [...reporters],
    reportCount,
    status,
    updatedAt: now,
    lastReportedAt: now,
    blockedAt: shouldBlock ? media.blockedAt || now : media.blockedAt,
    blockedReason: shouldBlock ? media.blockedReason || 'mass_report' : media.blockedReason || '',
  };
  upsertMedia(state, entry);
  return entry;
}

export function updateMediaStatus(state, media, { status, reason, moderatorHash } = {}) {
  if (!media) return null;
  const normalized = status === 'blocked' ? 'blocked' : 'locked';
  const now = new Date().toISOString();
  const entry = {
    ...media,
    status: normalized,
    updatedAt: now,
    blockedAt: normalized === 'blocked' ? now : null,
    blockedReason: normalized === 'blocked' ? sanitizeText(reason || 'moderator_block', 160) : '',
    blockedBy: normalized === 'blocked' ? moderatorHash || media.blockedBy || '' : '',
  };
  upsertMedia(state, entry);
  return entry;
}

function upsertMedia(state, entry) {
  if (!state.socialMedia) {
    state.socialMedia = [];
  }
  const index = state.socialMedia.findIndex((item) => item.id === entry.id);
  if (index >= 0) {
    state.socialMedia[index] = entry;
  } else {
    state.socialMedia.unshift(entry);
  }
}

function normalizeFilename(name = '') {
  const base = String(name).split(/[\\/]/).pop() || 'upload';
  const ascii = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return ascii || 'upload';
}

function resolveExtension(filename, contentType) {
  const ext = extname(filename || '').toLowerCase();
  if (ext) return ext;
  return EXTENSION_BY_TYPE[contentType] || '.bin';
}

async function moveTempFile(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (error.code === 'EXDEV') {
      await copyFile(source, destination);
      await unlink(source);
      return;
    }
    throw error;
  }
}

async function safeUnlink(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}
