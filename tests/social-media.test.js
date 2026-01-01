import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '../src/config.js';
import { createMedia, recordMediaViewRequest, reportMedia } from '../src/modules/social/media.js';

const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6sC2QAAAAASUVORK5CYII=',
  'base64',
);

function buildState() {
  return {
    socialMedia: [],
    settings: { policyId: 'party-circle-alpha', policyVersion: 1 },
  };
}

test('createMedia stores provider-local uploads as locked entries', async () => {
  const state = buildState();
  const person = { pidHash: 'hash-media-1', handle: 'person-hash' };
  let storedName = '';

  try {
    const media = await createMedia(state, {
      postId: 'post-1',
      person,
      file: {
        filename: 'sample.png',
        contentType: 'image/png',
        data: SAMPLE_PNG,
        size: SAMPLE_PNG.length,
      },
    });
    storedName = media.storedName;

    assert.equal(media.status, 'locked');
    assert.equal(media.kind, 'image');
    assert.ok(media.storedName.endsWith('.png'));
    assert.ok(media.policyId);
    assert.ok(state.socialMedia.find((entry) => entry.id === media.id));

    const info = await stat(join(PATHS.MEDIA_ROOT, storedName));
    assert.ok(info.size > 0);
  } finally {
    if (storedName) {
      await unlink(join(PATHS.MEDIA_ROOT, storedName)).catch(() => {});
    }
  }
});

test('recordMediaViewRequest tracks viewer requests', () => {
  const state = buildState();
  const media = {
    id: 'media-1',
    status: 'locked',
    viewRequests: 0,
    viewers: [],
    reporters: [],
  };
  state.socialMedia.push(media);
  const updated = recordMediaViewRequest(state, media, { actorHash: 'hash-viewer' });
  assert.equal(updated.viewRequests, 1);
  assert.deepEqual(updated.viewers, ['hash-viewer']);
});

test('reportMedia blocks after crossing threshold', () => {
  const state = buildState();
  const media = {
    id: 'media-2',
    status: 'locked',
    reporters: [],
    reportCount: 0,
    blockedReason: '',
  };
  state.socialMedia.push(media);
  const updated = reportMedia(state, media, { reporterHash: 'hash-report', threshold: 1 });
  assert.equal(updated.status, 'blocked');
  assert.equal(updated.reportCount, 1);
  assert.equal(updated.blockedReason, 'mass_report');
});
