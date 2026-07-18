import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCENT_KEYS,
  DENSITY_KEYS,
  normalizeHiddenSections,
  normalizeInterfaceSettings,
  sanitizeSectionKey,
} from '../src/interfaces/http/views/interfaceSettings.js';
import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

test('normalizeInterfaceSettings validates appearance choices and defaults on garbage', () => {
  const fromPost = normalizeInterfaceSettings({
    uiAccent: 'rose',
    uiDensity: 'compact',
    uiTheme: 'dark',
    uiLargeText: 'on',
  });
  assert.equal(fromPost.accent, 'rose');
  assert.equal(fromPost.density, 'compact');
  assert.equal(fromPost.theme, 'dark');
  assert.equal(fromPost.largeText, true);

  const garbage = normalizeInterfaceSettings({ accent: 'chartreuse', density: 'squished', theme: 'neon' });
  assert.equal(garbage.accent, 'violet');
  assert.equal(garbage.density, 'comfortable');
  assert.equal(garbage.theme, 'dark');

  // Every advertised key must survive a round-trip so the UI swatches stay honest.
  for (const key of ACCENT_KEYS) {
    assert.equal(normalizeInterfaceSettings({ accent: key }).accent, key);
  }
  for (const key of DENSITY_KEYS) {
    assert.equal(normalizeInterfaceSettings({ density: key }).density, key);
  }
});

test('normalizeInterfaceSettings accepts both stored-object and POST key shapes', () => {
  const stored = normalizeInterfaceSettings({ accent: 'teal', density: 'relaxed' });
  const post = normalizeInterfaceSettings({ uiAccent: 'teal', uiDensity: 'relaxed' });
  assert.deepEqual(stored, post);
});

test('normalizeHiddenSections sanitizes keys and drops empty/invalid entries', () => {
  const cleaned = normalizeHiddenSections({
    home: ['home-ops', 'home-ops', 'bad key!', 'home-overview'],
    'bad page!': ['x'],
    social: [],
  });
  assert.deepEqual(cleaned.home, ['home-ops', 'home-overview']);
  assert.equal(cleaned['bad page!'], undefined);
  assert.equal(cleaned.social, undefined);

  // Accepts a JSON string (as POSTed by the browser) and rejects malformed JSON.
  assert.deepEqual(normalizeHiddenSections('{"home":["home-ops"]}'), { home: ['home-ops'] });
  assert.deepEqual(normalizeHiddenSections('not json'), {});
});

test('sanitizeSectionKey rejects unsafe values', () => {
  assert.equal(sanitizeSectionKey('home-ops'), 'home-ops');
  assert.equal(sanitizeSectionKey('a.b_c-d'), 'a.b_c-d');
  assert.equal(sanitizeSectionKey('<script>'), '');
  assert.equal(sanitizeSectionKey(''), '');
  assert.equal(sanitizeSectionKey(42), '');
});

test('appearance defaults and hidden sections persist through the session and SSR', async () => {
  const port = await getAvailablePort();
  const server = await startServer({ port });
  try {
    const { cookie } = await createVerifiedSession(server.baseUrl);

    const saveResponse = await postForm(
      `${server.baseUrl}/profile`,
      {
        intent: 'ui-preferences',
        uiVerbosity: '',
        uiAccent: 'teal',
        uiDensity: 'compact',
        uiTheme: 'dark',
        uiHiddenSections: JSON.stringify({ home: ['home-ops'] }),
      },
      { cookie, partial: true },
    );
    assert.equal(saveResponse.status, 200);

    const { text: home } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });

    // The saved appearance renders onto <html> so it holds without JavaScript.
    assert.match(home, /<html[^>]*data-ui-accent="teal"/);
    assert.match(home, /<html[^>]*data-ui-density="compact"/);

    // The hidden section is stamped server-side on its opt-in panel.
    const opsTag = home.match(/<section[^>]*data-composer-section="home-ops"[^>]*>/);
    assert.ok(opsTag, 'home-ops section should be present in markup');
    assert.match(opsTag[0], /data-member-hidden="true"/);

    // A section the member did not hide stays visible.
    const overviewTag = home.match(/<section[^>]*data-composer-section="home-overview"[^>]*>/);
    assert.ok(overviewTag);
    assert.doesNotMatch(overviewTag[0], /data-member-hidden/);
  } finally {
    await server.stop();
  }
});
