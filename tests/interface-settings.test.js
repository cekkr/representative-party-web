import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCENT_KEYS,
  DENSITY_KEYS,
  THEME_KEYS,
  interfaceVocabulary,
  normalizeHiddenSections,
  normalizeInterfaceSettings,
  sanitizeSectionKey,
} from '../src/interfaces/http/views/interfaceSettings.js';
import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

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
  for (const key of THEME_KEYS) {
    assert.equal(normalizeInterfaceSettings({ theme: key }).theme, key);
  }
});

test('the theme vocabulary offers dark, light and system, and stays dark-first', () => {
  assert.deepEqual(THEME_KEYS, ['dark', 'light', 'system']);
  const vocabulary = interfaceVocabulary();
  assert.deepEqual(vocabulary.themes, THEME_KEYS);
  assert.deepEqual(vocabulary.accents, ACCENT_KEYS);
  assert.deepEqual(vocabulary.densities, DENSITY_KEYS);
  // The deployment default stays dark even though light is now selectable.
  assert.equal(vocabulary.defaults.theme, 'dark');
  assert.equal(normalizeInterfaceSettings({}).theme, 'dark');

  // Mutating the returned lists must not corrupt the module's own vocabulary.
  vocabulary.themes.push('neon');
  assert.deepEqual(interfaceVocabulary().themes, THEME_KEYS);
});

test('every theme key has a palette, and the two light blocks cannot drift apart', async () => {
  const css = await readFile(join(SRC, 'public/app.css'), 'utf8');

  // A key the Appearance control offers but the stylesheet does not implement would
  // render as an unstyled theme, so hold every key to having a colour-scheme rule.
  for (const key of THEME_KEYS) {
    assert.match(
      css,
      new RegExp(`:root\\[data-theme=['"]${key}['"]\\]`),
      `app.css must style :root[data-theme="${key}"]`,
    );
  }

  // Plain CSS cannot share one declaration body between a bare selector and a
  // media-query-scoped one, so the light palette is written twice: once for an
  // explicit Light choice, once for System + prefers-color-scheme. Editing only one
  // would give "System" a different palette than "Light" — assert they stay identical.
  const bodies = [...css.matchAll(/:root\[data-theme=['"]light['"]\]\s*\{([^}]*)\}/g)].map(
    ([, body]) => body,
  );
  const systemBody = css.match(
    /@media \(prefers-color-scheme: light\)\s*\{\s*:root\[data-theme=['"]system['"]\]\s*\{([^}]*)\}/,
  );
  assert.ok(systemBody, 'app.css must resolve data-theme="system" through prefers-color-scheme');

  const declarations = (body) =>
    body
      .split(';')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('--'))
      .sort();

  const lightPalette = bodies.map(declarations).find((list) => list.length > 4);
  assert.ok(lightPalette?.length, 'expected a populated :root[data-theme="light"] token block');
  assert.deepEqual(
    declarations(systemBody[1]),
    lightPalette,
    'the "system" light palette drifted from the explicit "light" palette — edit both blocks',
  );
});

test('every section-tagged panel outside the chromeless pages carries a friendly label', async () => {
  // The member "Sections" control falls back to heading text without a label, which
  // reads as page copy rather than a control. Chromeless pages (auth handoff, error,
  // module-disabled, admin-required) render no shell, so they are exempt by design.
  const CHROMELESS = new Set([
    'auth-eudi',
    'verification-complete',
    'error-message',
    'module-disabled',
    'admin-required',
  ]);

  async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (entry.name.endsWith('.html') || entry.name.endsWith('.js')) yield full;
    }
  }

  const missing = [];
  let tagged = 0;
  for await (const file of walk(join(SRC, 'modules'))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/<[a-z]+[^>]*\bdata-composer-section="([^"]+)"[^>]*>/g)) {
      const [tag, key] = [match[0], match[1]];
      tagged += 1;
      if (CHROMELESS.has(key)) continue;
      if (!/\bdata-section-label="[^"]+"/.test(tag)) missing.push(`${file.replace(SRC, '')} → ${key}`);
    }
  }

  assert.ok(tagged > 30, `expected the section inventory to be found, saw ${tagged}`);
  assert.deepEqual(missing, [], `sections missing data-section-label:\n  ${missing.join('\n  ')}`);
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

test('saved appearance and hidden sections survive the topbar verbosity toggle', async () => {
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
        uiTheme: 'light',
        uiHiddenSections: JSON.stringify({ home: ['home-ops'] }),
      },
      { cookie, partial: true },
    );
    assert.equal(saveResponse.status, 200);

    const saveVerbosity = (uiVerbosity) => postForm(
      `${server.baseUrl}/profile`,
      { intent: 'ui-preferences', uiVerbosity },
      { cookie, partial: true },
    );
    const compact = await saveVerbosity('compact');
    assert.equal(compact.status, 200);
    assert.match(await compact.text(), /data-verbosity-override="compact"/);

    const { text: home } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });

    // The saved appearance renders onto <html> so it holds without JavaScript.
    assert.match(home, /<html[^>]*data-ui-accent="teal"/);
    assert.match(home, /<html[^>]*data-ui-density="compact"/);
    assert.match(home, /<html[^>]*data-theme="light"/);

    // The hidden section is stamped server-side on its opt-in panel.
    const opsTag = home.match(/<section[^>]*data-composer-section="home-ops"[^>]*>/);
    assert.ok(opsTag, 'home-ops section should be present in markup');
    assert.match(opsTag[0], /data-member-hidden="true"/);

    // A section the member did not hide stays visible.
    const overviewTag = home.match(/<section[^>]*data-composer-section="home-overview"[^>]*>/);
    assert.ok(overviewTag);
    assert.doesNotMatch(overviewTag[0], /data-member-hidden/);

    const reset = await saveVerbosity('');
    assert.equal(reset.status, 200);
    assert.match(await reset.text(), /data-verbosity-override=""/);
    const { text: afterReset } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });
    assert.match(afterReset, /<html[^>]*data-theme="light"/);
    assert.match(afterReset, /<section[^>]*data-composer-section="home-ops"[^>]*data-member-hidden="true"/);

    const fullForm = await postForm(`${server.baseUrl}/profile`, {
      intent: 'ui-preferences', uiVerbosity: '', uiLargeText: 'off',
    }, { cookie, partial: true });
    assert.equal(fullForm.status, 200);
    const { text: afterFullForm } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });
    assert.match(afterFullForm, /<html[^>]*data-theme="dark"/);
    assert.doesNotMatch(afterFullForm, /<section[^>]*data-composer-section="home-ops"[^>]*data-member-hidden/);
  } finally {
    await server.stop();
  }
});

test('theme choice renders on <html> server-side and rejects unknown values', async () => {
  const port = await getAvailablePort();
  const server = await startServer({ port });
  try {
    const { cookie } = await createVerifiedSession(server.baseUrl);

    const save = async (uiTheme) =>
      postForm(
        `${server.baseUrl}/profile`,
        { intent: 'ui-preferences', uiVerbosity: '', uiAccent: 'violet', uiDensity: 'comfortable', uiTheme },
        { cookie, partial: true },
      );
    const themeOf = async () => {
      const { text } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });
      return text.match(/<html[^>]*data-theme="([^"]*)"/)?.[1];
    };

    // Light and system both round-trip, so the palette holds without JavaScript.
    for (const key of THEME_KEYS) {
      assert.equal((await save(key)).status, 200);
      assert.equal(await themeOf(), key, `theme "${key}" should render on <html>`);
    }

    // An unknown theme falls back to the dark-first default rather than rendering raw.
    assert.equal((await save('neon')).status, 200);
    assert.equal(await themeOf(), 'dark');

    // The browser reads its allowed keys from the server rather than a hand-kept copy.
    const { text } = await fetchText(`${server.baseUrl}/`, { headers: { Cookie: cookie } });
    const vocabularyAttr = text.match(/data-ui-vocabulary="([^"]*)"/)?.[1];
    assert.ok(vocabularyAttr, 'layout should ship the appearance vocabulary');
    const shipped = JSON.parse(vocabularyAttr.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    assert.deepEqual(shipped.themes, THEME_KEYS);
    assert.deepEqual(shipped.accents, ACCENT_KEYS);
    assert.deepEqual(shipped.densities, DENSITY_KEYS);
  } finally {
    await server.stop();
  }
});
