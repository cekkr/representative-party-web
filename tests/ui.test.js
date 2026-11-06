import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm, postJson } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { LATEST_SCHEMA_VERSION } from '../src/infra/persistence/migrations.js';
import { buildActivityPubCreateNote } from './helpers/activitypub.js';
import { captureViewport, assertSnapshot } from '../scripts/agent-viewport.js';

async function configurePage(page, baseUrl) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    const isExternal = !url.startsWith(baseUrl);
    if (isExternal && request.resourceType() === 'image') {
      request.abort();
    } else {
      request.continue();
    }
  });
}

async function setSessionCookie(page, baseUrl, sessionId) {
  await page.setCookie({
    name: 'circle_session',
    value: sessionId,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

function deriveHandle(pidHash, role = 'user') {
  const prefix = role === 'user' || role === 'person' ? role : 'user';
  return `${prefix}-${pidHash.slice(0, 8)}`;
}

async function getAdminForm(page, intent) {
  const intentSelector = `form[action="/admin"] input[name="intent"][value="${intent}"]`;
  const intentField = await page.$(intentSelector);
  assert.ok(intentField, `expected admin form for ${intent}`);
  return intentField.evaluateHandle((node) => node.closest('form'));
}

async function getAdminFormByAction(page, { intent, action }) {
  const forms = await page.$$('form[action="/admin"]');
  for (const form of forms) {
    const matches = await form.evaluate((node, intentValue, actionValue) => {
      const intentField = node.querySelector('input[name="intent"]');
      if (!intentField || intentField.value !== intentValue) return false;
      if (!actionValue) return true;
      const actionField = node.querySelector('input[name="action"]');
      return actionField && actionField.value === actionValue;
    }, intent, action);
    if (matches) return form;
  }
  return null;
}

loadMysqlTestEnv();
const MYSQL_UI_ENV = await buildMysqlUiEnv();

function loadMysqlTestEnv() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf-8');
    const parsed = parseDotEnv(raw);
    const keys = Object.keys(parsed || {});
    for (const key of keys) {
      if (!isMysqlTestEnvKey(key)) continue;
      if (process.env[key] === undefined) {
        process.env[key] = parsed[key];
      }
    }
  } catch (_error) {
    // .env is optional for tests
  }
}

function parseDotEnv(text = '') {
  const result = {};
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isMysqlTestEnvKey(key = '') {
  return key.startsWith('TEST_MYSQL_');
}

function normalizeMysqlTablePrefix(raw = '') {
  const cleaned = String(raw || 'state_entries_ui')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'state_entries_ui';
}

async function buildMysqlUiEnv() {
  const url = process.env.TEST_MYSQL_URL || '';
  const host = process.env.TEST_MYSQL_HOST || '';
  const user = process.env.TEST_MYSQL_USER || '';
  const database = process.env.TEST_MYSQL_DATABASE || '';
  const port = process.env.TEST_MYSQL_PORT || '';
  const password = process.env.TEST_MYSQL_PASSWORD || '';
  const enabled = Boolean(url || (host && user && database));
  const tablePrefix = normalizeMysqlTablePrefix(process.env.TEST_MYSQL_TABLE_PREFIX);
  const table = `${tablePrefix}_${process.pid}_${Date.now()}`;
  if (!enabled) {
    return { enabled: false, skip: 'mysql ui test env not configured' };
  }
  const availability = await checkMysqlAvailability({ url, host, port, user, password, database });
  if (!availability.ok) {
    return { enabled: false, skip: availability.reason };
  }
  return {
    enabled: true,
    skip: false,
    url,
    host,
    port,
    user,
    password,
    database,
    table,
    extraEnv: {
      DATA_MYSQL_URL: url,
      DATA_MYSQL_HOST: host,
      DATA_MYSQL_PORT: port,
      DATA_MYSQL_USER: user,
      DATA_MYSQL_PASSWORD: password,
      DATA_MYSQL_DATABASE: database,
      DATA_MYSQL_TABLE: table,
    },
  };
}

async function checkMysqlAvailability({ url, host, port, user, password, database }) {
  let mysql;
  try {
    const mod = await import('mysql2/promise');
    mysql = mod.default || mod;
  } catch (_error) {
    return { ok: false, reason: 'mysql2 dependency missing' };
  }
  const config = resolveMysqlConfig({ url, host, port, user, password, database });
  if (!config.user) {
    return { ok: false, reason: 'mysql user missing' };
  }
  if (!config.database) {
    return { ok: false, reason: 'mysql database missing' };
  }
  try {
    const connection = await mysql.createConnection(config);
    await connection.query('SELECT 1');
    await connection.end();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `mysql unavailable: ${error?.code || error?.message || 'unknown'}` };
  }
}

function resolveMysqlConfig({ url, host, port, user, password, database }) {
  if (url) {
    try {
      const parsed = new URL(url);
      const resolvedDatabase = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
      return {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 3306,
        user: decodeURIComponent(parsed.username || ''),
        password: decodeURIComponent(parsed.password || ''),
        database: resolvedDatabase,
        connectTimeout: 1000,
      };
    } catch (_error) {
      return { host: '', port: 3306, user: '', password: '', database: '', connectTimeout: 1000 };
    }
  }
  const config = {
    host: host || '127.0.0.1',
    port: port ? Number(port) : 3306,
    user: user || '',
    password: password || undefined,
    database: database || '',
    connectTimeout: 1000,
  };
  if (!config.password) delete config.password;
  return config;
}

async function dropMysqlUiTable(mysqlEnv) {
  if (!mysqlEnv?.enabled) return;
  if (!/^[a-z0-9_]+$/i.test(mysqlEnv.table || '')) return;
  let mysql;
  try {
    const mod = await import('mysql2/promise');
    mysql = mod.default || mod;
  } catch (_error) {
    return;
  }
  const config = resolveMysqlConfig(mysqlEnv);
  if (!config.user || !config.database) return;
  let connection;
  try {
    connection = await mysql.createConnection(config);
    await connection.query(`DROP TABLE IF EXISTS \`${mysqlEnv.table}\``);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

test('UI respects roles, privileges, module toggles, and background styling', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const personSession = await createVerifiedSession(server.baseUrl, { pidHash: 'person-ui' });
  const moderatorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'moderator-ui' });
  const bannedSession = await createVerifiedSession(server.baseUrl, { pidHash: 'banned-ui' });

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: moderatorSession.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );
  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: bannedSession.sessionId, sessionRole: 'person', sessionBanned: 'on' },
    { partial: true },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const guestContext = await browser.createBrowserContext();
  const personContext = await browser.createBrowserContext();
  const moderatorContext = await browser.createBrowserContext();
  const bannedContext = await browser.createBrowserContext();
  t.after(async () => browser.close());

  const guestPage = await guestContext.newPage();
  await configurePage(guestPage, server.baseUrl);
  await guestPage.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  // The themed dark surface must be applied to the body (the shared app theme loaded),
  // whether that is a flat colour or a gradient. Assert the background renders dark
  // rather than the UA default, without pinning an exact palette value.
  const bodyBg = await guestPage.evaluate(() => {
    const style = window.getComputedStyle(document.body);
    return { image: style.backgroundImage || '', color: style.backgroundColor || '' };
  });
  const rgb = (bodyBg.color.match(/\d+/g) || []).map(Number);
  const isDarkColor = rgb.length >= 3 && (rgb[0] + rgb[1] + rgb[2]) / 3 < 60;
  assert.ok(
    bodyBg.image.includes('gradient') || isDarkColor,
    `expected a themed dark background, got image="${bodyBg.image}" color="${bodyBg.color}"`,
  );

  await guestPage.goto(`${server.baseUrl}/discussion?compose=post`, { waitUntil: 'networkidle0' });
  await guestPage.waitForSelector('main a[href="/auth/eudi"]', { visible: true });
  await guestPage.waitForSelector('#discussion-compose form', { hidden: true });
  const guestPost = await postForm(`${server.baseUrl}/discussion`, { content: 'Guest post attempt' });
  assert.equal(guestPost.status, 401);
  assert.equal((await guestPost.json()).error, 'verification_required');

  const personPage = await personContext.newPage();
  await configurePage(personPage, server.baseUrl);
  await setSessionCookie(personPage, server.baseUrl, personSession.sessionId);
  await personPage.goto(`${server.baseUrl}/discussion?compose=post`, { waitUntil: 'networkidle0' });
  await personPage.type('input[name="topic"]', 'Energy');
  await personPage.type('textarea[name="content"]', 'Person post');
  await personPage.click('#discussion-compose button[type="submit"]');
  await personPage.waitForFunction(() => document.body.textContent.includes('Person post'));

  await personPage.goto(`${server.baseUrl}/petitions?compose=proposal`, { waitUntil: 'networkidle0' });
  await personPage.type('input[name="title"]', 'UI Petition');
  await personPage.type('textarea[name="summary"]', 'Testing petition flow');
  await personPage.click('#petitions-compose form button[type="submit"]');
  await personPage.waitForFunction(() => document.body.textContent.includes('UI Petition'));
  const moderationForm = await personPage.$('form[action="/petitions/status"]');
  assert.equal(moderationForm, null);

  const moderatorPage = await moderatorContext.newPage();
  await configurePage(moderatorPage, server.baseUrl);
  await setSessionCookie(moderatorPage, server.baseUrl, moderatorSession.sessionId);
  await moderatorPage.goto(personPage.url(), { waitUntil: 'networkidle0' });
  await moderatorPage.waitForFunction(() => document.body.textContent.includes('UI Petition'));
  const moderatorForm = await moderatorPage.$('form[action="/petitions/status"]');
  assert.ok(moderatorForm);

  const bannedPage = await bannedContext.newPage();
  await configurePage(bannedPage, server.baseUrl);
  await setSessionCookie(bannedPage, server.baseUrl, bannedSession.sessionId);
  await bannedPage.goto(`${server.baseUrl}/discussion?compose=post`, { waitUntil: 'networkidle0' });
  await bannedPage.waitForSelector('#discussion-compose form', { hidden: true });
  assert.match(await bannedPage.$eval('#discussion-compose', (el) => el.innerText), /banned/i);
  const bannedPost = await postForm(`${server.baseUrl}/discussion`, { content: 'Banned post attempt' }, bannedSession);
  assert.equal(bannedPost.status, 401);
  assert.equal((await bannedPost.json()).error, 'banned');

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'modules', module_delegation: 'on', module_federation: 'on', module_topicGardener: 'on' },
    { partial: true },
  );

  await guestPage.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await guestPage.$('[data-nav-section="social"]'), null);
  assert.equal(await guestPage.$('[data-nav-section="petitions"]'), null);
  assert.equal(await guestPage.$('[data-nav-section="groups"]'), null);

  await guestPage.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await guestPage.$('[data-module-disabled="social"]'));

  await guestPage.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await guestPage.$('[data-module-disabled="petitions"]'));
});

test('workspace shell supports keyboard navigation with or without enhancement', { timeout: 60000 }, async (t) => {
  const server = await startServer({
    port: await getAvailablePort(),
    extraEnv: { ENFORCE_CIRCLE: 'true', CIRCLE_NAME: 'Rete Civica Nazionale' },
  });
  t.after(async () => server.stop());
  const { baseUrl } = server;
  const member = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero-shell-ui' });
  const admin = await createVerifiedSession(baseUrl, { pidHash: 'provider-admin-shell-ui' });
  assert.equal((await postForm(baseUrl + '/profile', {
    intent: 'handle', handle: 'giulia.ferrero',
  }, member)).status, 200);
  assert.equal((await postForm(baseUrl + '/admin', { intent: 'modules' })).status, 200);
  assert.equal((await postForm(baseUrl + '/admin', {
    intent: 'session', sessionId: admin.sessionId, sessionRole: 'admin',
  })).status, 200);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  t.after(async () => browser.close());
  const page = await browser.newPage();
  await setSessionCookie(page, baseUrl, member.sessionId);
  const nav = '.side-nav--mobile';
  const menuToggle = 'details[data-nav-disclosure] > summary';
  const navLink = (href) => `${nav} [data-nav-link][href="${href}"]`;

  const tabTo = async (selector) => {
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press('Tab');
      if (await page.evaluate((target) => document.activeElement.matches(target), selector)) return;
    }
    assert.fail(`could not reach ${selector} by keyboard`);
  };
  const openMenu = async () => {
    await tabTo(menuToggle);
    await page.keyboard.press('Enter');
    assert.ok(await page.$('details[data-nav-disclosure][open]'));
  };

  await page.setJavaScriptEnabled(false);
  for (const { width, height, theme } of [
    { width: 390, height: 844, theme: 'dark' },
    { width: 800, height: 600, theme: 'light' },
  ]) {
    assert.equal((await postForm(baseUrl + '/profile', {
      intent: 'ui-preferences', uiTheme: theme, uiAccent: 'blue',
    }, member)).status, 200);
    await page.setViewport({ width, height });
    await page.goto(baseUrl, { waitUntil: 'load' });
    assert.equal(await page.$eval('html', (el) => el.dataset.theme), theme);
    assert.equal((await page.$$('h1')).length, 1);
    assert.equal((await page.$$('main')).length, 1);
    const status = await page.$eval('.status-strip', (el) => el.innerText);
    assert.match(status, /Circle enforcement:\s*strict/i);
    assert.match(status, /Validation:\s*strict\s*\(previews hidden\)/i);
    assert.match(status, /Gossip ingest:\s*off/i);
    assert.match(status, /Ledger\s+\d+.*Actors\s+\d+.*Discussions\s+\d+/i);
    assert.match(status, /@giulia\.ferrero/);

    for (const href of ['/discussion', '/forum', '/notifications']) {
      await openMenu();
      assert.equal(await page.$(`${nav} a:is([href="/petitions"], [href="/delegation"], [href="/delegates"], [href="/groups"], [href="/admin"])`), null);
      await tabTo(navLink(href));
      const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }),
        page.keyboard.press('Enter'),
      ]);
      assert.equal(response.status(), 200);
      assert.equal(new URL(page.url()).pathname, href);
      const current = await page.$eval(`${navLink(href)}[aria-current="page"]`, (el) => el.textContent.trim());
      assert.equal(await page.$eval('[data-nav-location]', (el) => el.innerText.trim()), current);

      if (href === '/discussion') {
        await tabTo('main a[href$="#discussion-compose"]');
        await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.keyboard.press('Enter')]);
        assert.equal(new URL(page.url()).hash, '#discussion-compose');
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => document.activeElement.closest('#discussion-compose') !== null));
        assert.ok(await page.waitForSelector('#discussion-compose textarea[name="content"]', { visible: true }));
      }
      await page.goto(baseUrl, { waitUntil: 'load' });
    }

    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '#main-content');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    await page.goto('about:blank');
  }

  await page.setJavaScriptEnabled(true);
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.evaluate(() => { document.body.dataset.shellTest = 'same-document'; });
  await openMenu();
  await tabTo(navLink('/discussion'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/discussion');
  assert.equal(await page.$eval('body', (el) => el.dataset.shellTest), 'same-document');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('main h1')), true);
  assert.ok(await page.$(`${navLink('/discussion')}[aria-current="page"]`));
  assert.equal(await page.$eval('[data-nav-location]', (el) => el.innerText.trim()), 'Discussion');
  assert.equal(await page.$('details[data-nav-disclosure][open]'), null);
  await tabTo('main a[href$="#discussion-compose"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.id === 'discussion-compose');
});

test('UI shows gossip controls and preview/provenance pills', { timeout: 60000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-ui-preview-'));
  const kvFile = path.join(tempDir, 'state.json');
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  const seed = {
    discussions: [
      {
        id: 'preview-discussion',
        topic: 'Preview',
        stance: 'neutral',
        content: 'Preview content for provenance pills.',
        authorHash: 'peer-hash',
        createdAt: now,
        validationStatus: 'preview',
        issuer: 'peer-node',
      },
    ],
    petitions: [
      {
        id: 'preview-petition',
        title: 'Preview Petition',
        summary: 'Preview summary',
        body: '',
        authorHash: 'peer-hash',
        createdAt: now,
        status: 'draft',
        quorum: 0,
        topic: 'general',
        validationStatus: 'preview',
        issuer: 'peer-node',
      },
    ],
    transactionSummaries: [
      {
        id: 'tx-summary-1',
        issuer: 'peer-node',
        summary: 'deadbeefcafebabe',
        entryCount: 3,
        entries: [],
        policy: { id: 'party-circle-alpha', version: 1 },
        profile: { mode: 'hybrid', adapter: 'kv' },
        status: 'validated',
        validationStatus: 'validated',
        verification: { valid: true, skipped: false },
        receivedAt: now,
        issuedAt: now,
      },
    ],
    settings: { initialized: true },
    meta: { schemaVersion: LATEST_SCHEMA_VERSION, migrations: [] },
  };
  await writeFile(kvFile, JSON.stringify(seed, null, 2));

  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'kv', dataMode: 'hybrid', allowPreviews: true, kvFile });
  t.after(async () => server.stop());

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('deadbeefcafe'));

  const pushDisabled = await page.$eval('button[data-gossip="push"]', (el) => el.hasAttribute('disabled'));
  const pullDisabled = await page.$eval('button[data-gossip="pull"]', (el) => el.hasAttribute('disabled'));
  assert.equal(pushDisabled, false);
  assert.equal(pullDisabled, false);

  await postForm(`${server.baseUrl}/admin`, { intent: 'modules' }, { partial: true });
  await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle0' });
  const pushDisabledAfter = await page.$eval('button[data-gossip="push"]', (el) => el.hasAttribute('disabled'));
  assert.equal(pushDisabledAfter, true);

  await page.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('Preview'));
  await page.waitForFunction(() => document.body.textContent.includes('peer-node'));
});

test('UI renders delegation form when module enabled', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await page.goto(`${server.baseUrl}/delegation`, { waitUntil: 'networkidle0' });

  const form = await page.$('form[action="/delegation"]');
  assert.ok(form);
  const delegateField = await page.$('input[name="delegateHash"]');
  assert.ok(delegateField);
});

test('UI social feed supports follows, filters, and reshares', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const aliceSession = await createVerifiedSession(server.baseUrl, { pidHash: 'alice-ui-social' });
  const bobSession = await createVerifiedSession(server.baseUrl, { pidHash: 'bob-ui-social' });
  const bobHandle = deriveHandle(bobSession.pidHash);

  await postForm(
    `${server.baseUrl}/social/post`,
    { content: 'Bob update for follow', visibility: 'public' },
    { cookie: bobSession.cookie },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, aliceSession.sessionId);
  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });

  await page.click('#social-follows summary');
  await page.type('form[action="/social/follow"] input[name="handle"]', bobHandle);
  await page.type('form[action="/social/follow"] input[name="type"]', 'interest');
  await page.click('form[action="/social/follow"] button[type="submit"]');
  await page.waitForFunction((handle) => document.body.textContent.includes(handle), {}, bobHandle);
  await page.waitForFunction(() => document.body.textContent.includes('Bob update for follow'));
  await page.waitForFunction(() => document.body.textContent.includes('Follow: interest'));

  await page.click('#social-controls summary');
  await page.select('form[action="/social/feed"] select[name="type"]', 'alerts');
  await page.click('#social-controls button[type="submit"]');
  await page.waitForFunction(() => {
    const feed = document.querySelector('.wall-feed');
    return feed && feed.textContent.includes('No updates match this follow type');
  });

  await page.select('form[action="/social/feed"] select[name="type"]', 'interest');
  await page.click('#social-controls button[type="submit"]');
  await page.waitForFunction(() => {
    const feed = document.querySelector('.wall-feed');
    return feed && feed.textContent.includes('Bob update for follow');
  });

  await page.evaluate(() => {
    const details = Array.from(document.querySelectorAll('details.form-toggle')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Reshare'),
    );
    if (details) details.open = true;
  });
  const reshareForm = await page.$('form[data-enhance="social-reshare"]');
  assert.ok(reshareForm);
  const reshareTextarea = await reshareForm.$('textarea[name="content"]');
  if (reshareTextarea) {
    await reshareTextarea.type('Passing this along');
  }
  const reshareButton = await reshareForm.$('button[type="submit"]');
  await reshareButton.click();
  await page.waitForFunction(() => document.body.textContent.includes('Reshared from'));
});

test('UI auto-collapses an empty social composer and keeps a draft open', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'social-scroll-ui' });
  for (let index = 0; index < 28; index += 1) {
    await postForm(
      `${server.baseUrl}/social/post`,
      { content: `Scroll coverage post ${index + 1}`, visibility: 'public' },
      { cookie: session.cookie },
    );
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 800 });
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, session.sessionId);
  await page.goto(`${server.baseUrl}/social/feed?compose=post`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#social-compose details[open]');

  await page.evaluate(() => {
    window.scrollTo({ top: 1400, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll'));
  });

  await page.waitForSelector('#social-compose details:not([open])');
  await page.reload({ waitUntil: 'networkidle0' });
  const field = '#social-compose textarea[name="content"]';
  await page.type(field, 'A short draft');
  await page.$eval(field, (input) => input.blur());
  await page.evaluate(() => window.scrollBy(0, 1400));
  await page.waitForFunction(() => document.getElementById('social-compose').getBoundingClientRect().bottom < 0);
  assert.equal(await page.$eval(field, (input) => input.value), 'A short draft');
  assert.ok(await page.$('#social-compose details[open]'));
});

test('UI interface settings and nav filter improve practical navigation', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'ui-settings-nav' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, session.sessionId);
  await page.goto(`${server.baseUrl}/social/feed?compose=post`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#social-compose details[open]');

  await page.click('[data-ui-settings-toggle]');
  await page.waitForSelector('[data-ui-settings-panel]:not([hidden])');

  const enableToggle = async (selector) => {
    const toggle = await page.$(selector);
    assert.ok(toggle, `missing toggle ${selector}`);
    const checked = await toggle.evaluate((el) => el.checked);
    if (!checked) {
      await toggle.click();
    }
  };

  await enableToggle('input[data-ui-setting="keepComposerOpen"]');
  await enableToggle('input[data-ui-setting="compactNav"]');
  await page.click('[data-ui-settings-close]');
  await page.waitForFunction(
    () =>
      document.body.dataset.uiComposerAutocollapse === 'off' && document.body.dataset.uiNav === 'compact',
  );

  await page.evaluate(() => {
    window.scrollTo({ top: 1400, behavior: 'auto' });
    window.dispatchEvent(new Event('scroll'));
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(await page.$('#social-compose details[open]'));

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.keyboard.type('governance');
  await page.waitForFunction(() => {
    const home = document.querySelector('.side-nav--desktop [data-nav-section="home"]');
    const governance = document.querySelector('.side-nav--desktop [data-nav-section="governance"]');
    return home && governance && home.hidden === true && governance.hidden === false;
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const home = document.querySelector('.side-nav--desktop [data-nav-section="home"]');
    const filter = document.querySelector('.side-nav--desktop [data-nav-filter-input]');
    return home && filter && home.hidden === false && !filter.value;
  });

  await page.click('[data-ui-settings-toggle]');
  await page.waitForSelector('[data-ui-settings-panel]:not([hidden])');
  const partialToggle = await page.$('input[data-ui-setting="partialNavigation"]');
  assert.ok(partialToggle);
  const partialChecked = await partialToggle.evaluate((el) => el.checked);
  if (partialChecked) {
    await partialToggle.click();
  }
  await page.click('[data-ui-settings-close]');
  await page.waitForFunction(() => document.body.dataset.uiPartialNav === 'off');

  const navPromise = page.waitForNavigation({ waitUntil: 'networkidle0' });
  await page.click('.side-nav--desktop [data-nav-section="discussion"] [data-nav-link]');
  await navPromise;
  assert.match(page.url(), /\/discussion$/);

  const persisted = await page.evaluate(() => JSON.parse(window.localStorage.getItem('organization-web-ui-settings') || '{}'));
  assert.equal(persisted.keepComposerOpen, true);
  assert.equal(persisted.partialNavigation, false);
});

test('UI interface panel can save session defaults without leaving the page', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'ui-settings-inline-save' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const guestPage = await browser.newPage();
  await configurePage(guestPage, server.baseUrl);
  await guestPage.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await guestPage.click('[data-ui-settings-toggle]');
  await guestPage.waitForSelector('[data-ui-settings-panel]:not([hidden])');
  const guestSaveDisabled = await guestPage.$eval('[data-ui-settings-save]', (el) => el.disabled);
  assert.equal(guestSaveDisabled, true);

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, session.sessionId);
  await page.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await page.click('[data-ui-settings-toggle]');
  await page.waitForSelector('[data-ui-settings-panel]:not([hidden])');
  const saveDisabled = await page.$eval('[data-ui-settings-save]', (el) => el.disabled);
  assert.equal(saveDisabled, false);

  const setToggle = async (selector, expectedChecked) => {
    const input = await page.$(selector);
    assert.ok(input, `missing input ${selector}`);
    const checked = await input.evaluate((el) => el.checked);
    if (checked !== expectedChecked) {
      await input.click();
    }
  };

  await setToggle('input[data-ui-setting="largeText"]', true);
  await setToggle('input[data-ui-setting="partialNavigation"]', false);
  await page.click('[data-ui-settings-save]');
  await page.waitForFunction(() => document.body.textContent.includes('Session defaults saved.'));

  await setToggle('input[data-ui-setting="partialNavigation"]', true);
  await page.waitForFunction(() => document.body.dataset.uiPartialNav === 'on');
  await page.click('[data-ui-settings-reset]');
  await page.waitForFunction(() => document.body.dataset.uiPartialNav === 'off');
  await page.waitForFunction(() => document.body.dataset.uiTextScale === 'large');

  const freshContext = await browser.createBrowserContext();
  const freshPage = await freshContext.newPage();
  await configurePage(freshPage, server.baseUrl);
  await setSessionCookie(freshPage, server.baseUrl, session.sessionId);
  await freshPage.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await freshPage.waitForFunction(() => document.body.dataset.uiTextScale === 'large');
  await freshPage.waitForFunction(() => document.body.dataset.uiPartialNav === 'off');
});

test('UI profile interface defaults hydrate runtime settings when local overrides are absent', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'ui-profile-defaults' });
  await postForm(
    `${server.baseUrl}/profile`,
    {
      intent: 'ui-preferences',
      uiVerbosity: 'default',
      uiLargeText: 'on',
      uiReducedMotion: 'on',
      uiCompactNav: 'on',
      uiKeepComposerOpen: 'on',
      uiPartialNavigation: 'off',
    },
    { cookie: session.cookie, partial: true },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, session.sessionId);
  await page.goto(`${server.baseUrl}/social/feed?compose=post`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const body = document.body;
    return (
      body.dataset.uiTextScale === 'large' &&
      body.dataset.uiMotion === 'reduced' &&
      body.dataset.uiNav === 'compact' &&
      body.dataset.uiComposerAutocollapse === 'off' &&
      body.dataset.uiPartialNav === 'off'
    );
  });

  await page.click('[data-ui-settings-toggle]');
  await page.waitForSelector('[data-ui-settings-panel]:not([hidden])');
  const panelState = await page.evaluate(() => ({
    large: document.querySelector('input[data-ui-setting="largeText"]')?.checked,
    reduced: document.querySelector('input[data-ui-setting="reducedMotion"]')?.checked,
    compact: document.querySelector('input[data-ui-setting="compactNav"]')?.checked,
    keepOpen: document.querySelector('input[data-ui-setting="keepComposerOpen"]')?.checked,
    partial: document.querySelector('input[data-ui-setting="partialNavigation"]')?.checked,
  }));
  assert.equal(panelState.large, true);
  assert.equal(panelState.reduced, true);
  assert.equal(panelState.compact, true);
  assert.equal(panelState.keepOpen, true);
  assert.equal(panelState.partial, false);

  const partialToggle = await page.$('input[data-ui-setting="partialNavigation"]');
  assert.ok(partialToggle);
  await partialToggle.click();
  await page.waitForFunction(() => document.body.dataset.uiPartialNav === 'on');
  const localAfterToggle = await page.evaluate(() => window.localStorage.getItem('organization-web-ui-settings'));
  assert.ok(localAfterToggle, 'expected local UI settings after local toggle');

  await page.click('[data-ui-settings-reset]');
  await page.waitForFunction(() => document.body.dataset.uiPartialNav === 'off');
  const localAfterReset = await page.evaluate(() => window.localStorage.getItem('organization-web-ui-settings'));
  assert.equal(localAfterReset, null);
});

test('UI mysql adapter keeps discussion, interface defaults, and module toggles across restart', { timeout: 120000 }, async (t) => {
  if (MYSQL_UI_ENV.skip) {
    t.skip(MYSQL_UI_ENV.skip);
    return;
  }
  t.after(async () => {
    await dropMysqlUiTable(MYSQL_UI_ENV);
  });

  const portFirst = await getAvailablePort();
  const firstServer = await startServer({
    port: portFirst,
    dataAdapter: 'mysql',
    extraEnv: MYSQL_UI_ENV.extraEnv,
  });
  t.after(async () => firstServer.stop());

  const session = await createVerifiedSession(firstServer.baseUrl, { pidHash: 'mysql-ui-session' });
  await postForm(
    `${firstServer.baseUrl}/admin`,
    { intent: 'session', sessionId: session.sessionId, sessionRole: 'admin' },
    { partial: true },
  );
  await postForm(
    `${firstServer.baseUrl}/profile`,
    {
      intent: 'ui-preferences',
      uiVerbosity: 'default',
      uiLargeText: 'on',
      uiReducedMotion: 'off',
      uiCompactNav: 'off',
      uiKeepComposerOpen: 'on',
      uiPartialNavigation: 'off',
    },
    { cookie: session.cookie, partial: true },
  );
  await postForm(
    `${firstServer.baseUrl}/discussion`,
    { topic: 'mysql-persist', content: 'MySQL UI persistence discussion' },
    { cookie: session.cookie },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const pageFirst = await browser.newPage();
  await configurePage(pageFirst, firstServer.baseUrl);
  await setSessionCookie(pageFirst, firstServer.baseUrl, session.sessionId);
  await pageFirst.goto(`${firstServer.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await pageFirst.waitForFunction(() => document.body.textContent.includes('MySQL UI persistence discussion'));
  await pageFirst.waitForFunction(
    () => document.body.dataset.uiTextScale === 'large' && document.body.dataset.uiPartialNav === 'off',
  );

  await pageFirst.goto(`${firstServer.baseUrl}/admin`, { waitUntil: 'networkidle0' });
  const modulesForm = await getAdminForm(pageFirst, 'modules');
  const socialToggle = await modulesForm.$('input[name="module_social"]');
  const petitionsToggle = await modulesForm.$('input[name="module_petitions"]');
  assert.ok(socialToggle);
  assert.ok(petitionsToggle);
  if (await socialToggle.evaluate((el) => el.checked)) {
    await socialToggle.evaluate((el) => el.click());
  }
  if (await petitionsToggle.evaluate((el) => el.checked)) {
    await petitionsToggle.evaluate((el) => el.click());
  }
  const modulesResponse = pageFirst.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const modulesButton = await modulesForm.$('button[type="submit"]');
  await modulesButton.click();
  await modulesResponse;
  await pageFirst.waitForFunction(() => document.body.textContent.includes('Module toggles updated'));

  await pageFirst.goto(`${firstServer.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await pageFirst.$('[data-nav-section="social"]'), null);
  assert.equal(await pageFirst.$('[data-nav-section="petitions"]'), null);
  await pageFirst.goto(`${firstServer.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await pageFirst.$('[data-module-disabled="social"]'));
  await pageFirst.goto(`${firstServer.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await pageFirst.$('[data-module-disabled="petitions"]'));

  await firstServer.stop();

  const portSecond = await getAvailablePort();
  const secondServer = await startServer({
    port: portSecond,
    dataAdapter: 'mysql',
    extraEnv: MYSQL_UI_ENV.extraEnv,
  });
  t.after(async () => secondServer.stop());

  const pageSecond = await browser.newPage();
  await configurePage(pageSecond, secondServer.baseUrl);
  await setSessionCookie(pageSecond, secondServer.baseUrl, session.sessionId);
  await pageSecond.goto(`${secondServer.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await pageSecond.waitForFunction(() => document.body.textContent.includes('MySQL UI persistence discussion'));
  await pageSecond.waitForFunction(
    () => document.body.dataset.uiTextScale === 'large' && document.body.dataset.uiPartialNav === 'off',
  );
  await pageSecond.goto(`${secondServer.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await pageSecond.$('[data-nav-section="social"]'), null);
  assert.equal(await pageSecond.$('[data-nav-section="petitions"]'), null);
  await pageSecond.goto(`${secondServer.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await pageSecond.$('[data-module-disabled="social"]'));
  await pageSecond.goto(`${secondServer.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await pageSecond.$('[data-module-disabled="petitions"]'));
});

test('UI marks ActivityPub inbound posts', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory', allowPreviews: true });
  t.after(async () => server.stop());

  const content = 'ActivityPub inbound note';
  const payload = buildActivityPubCreateNote({
    content,
    activityId: 'https://remote.example/ap/activities/ui-1',
    objectId: 'https://remote.example/ap/objects/ui-1',
  });
  const inboxResponse = await postJson(`${server.baseUrl}/ap/inbox`, payload);
  assert.equal(inboxResponse.status, 202);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  await page.waitForFunction((text) => document.body.textContent.includes(text), {}, content);
  const hasActivityPubPill = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.pill')).some((el) => el.textContent.trim() === 'ActivityPub'),
  );
  assert.equal(hasActivityPubPill, true);
});

test('UI social feed supports media uploads with locked view and report blocking', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-ui-media-'));
  const mediaPath = path.join(tempDir, 'sample.png');
  await writeFile(
    mediaPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6sC2QAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const server = await startServer({
    port,
    dataAdapter: 'memory',
    extraEnv: { SOCIAL_MEDIA_REPORT_THRESHOLD: '1', SOCIAL_MEDIA_UPLOADS_ROOT: path.join(tempDir, 'uploads') },
  });
  t.after(async () => server.stop());

  const authorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'media-ui-author' });
  const recipient = await createVerifiedSession(server.baseUrl, { pidHash: 'anna-conti' });
  const outsider = await createVerifiedSession(server.baseUrl, { pidHash: 'luca-esposito' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 600 });
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, authorSession.sessionId);
  await page.setJavaScriptEnabled(false);
  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });

  await page.focus('main [data-social-compose-link]');
  await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
  await page.select('#social-compose select[name="visibility"]', 'direct');
  await page.type('#social-compose input[name="targetHandle"]', deriveHandle(recipient.pidHash));
  const fileInput = await page.$('form[action="/social/post"] input[name="media"]');
  assert.ok(fileInput);
  await fileInput.uploadFile(mediaPath);
  await Promise.all([page.waitForNavigation(), page.click('#social-compose button[type="submit"]')]);
  await page.waitForSelector('.media-card.locked');
  assert.equal(new URL(page.url()).pathname, '/social/feed');
  assert.match(await page.$eval('.social-post', (post) => post.textContent), /Direct to @user-anna/);
  const parentId = await page.$eval('input[name="replyTo"]', (input) => input.value);

  const requestHref = await page.$eval(
    'a[href^="/social/media/"][href*="view=1"]',
    (node) => node.getAttribute('href'),
  );
  assert.ok(requestHref);
  const mediaId = requestHref.split('/').pop().split('?')[0];
  assert.ok(mediaId);

  const forbiddenView = await fetch(`${server.baseUrl}${requestHref}`, { headers: { Cookie: outsider.cookie } });
  assert.equal(forbiddenView.status, 404);
  const forbiddenReport = await postForm(`${server.baseUrl}/social/media/report`, { mediaId }, outsider);
  assert.equal(forbiddenReport.status, 404);
  const reply = { replyTo: parentId, visibility: 'public', content: 'Can we use this at the banchetto?' };
  const forbiddenReply = await postForm(`${server.baseUrl}/social/reply`, reply, outsider);
  assert.equal(forbiddenReply.status, 404);
  assert.equal((await postForm(`${server.baseUrl}/social/reply`, reply, recipient)).status, 200);
  const outsiderFeed = await fetchText(`${server.baseUrl}/social/feed`);
  assert.doesNotMatch(outsiderFeed.text, /Can we use this at the banchetto/);
  const authorFeed = await fetchText(`${server.baseUrl}/social/feed`, { headers: { Cookie: authorSession.cookie } });
  assert.match(authorFeed.text, /Can we use this at the banchetto/);
  assert.match(authorFeed.text, /Direct to you/);

  const lockedStatus = await page.evaluate(async (id) => {
    const response = await fetch(`/social/media/${id}`);
    return response.status;
  }, mediaId);
  assert.equal(lockedStatus, 423);

  const viewResult = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return { status: response.status, type: response.headers.get('content-type') || '' };
  }, requestHref);
  assert.equal(viewResult.status, 200);
  assert.ok(viewResult.type.includes('image/'));

  await Promise.all([
    page.waitForNavigation(),
    page.click('form[data-enhance="social-media-report"] button'),
  ]);
  await page.waitForSelector('.media-card.blocked');
  assert.equal(await page.$('form[data-enhance="social-reshare"]'), null);

  const blockedStatus = await page.evaluate(async (id) => {
    const response = await fetch(`/social/media/${id}?view=1`);
    return response.status;
  }, mediaId);
  assert.equal(blockedStatus, 451);
});

test('UI notifications surface mentions and persist preferences', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const authorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'author-ui-note' });
  const commenterSession = await createVerifiedSession(server.baseUrl, { pidHash: 'commenter-ui-note' });
  const authorHandle = deriveHandle(authorSession.pidHash);

  await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Notify Petition', summary: 'Testing notifications', body: '' },
    { cookie: authorSession.cookie },
  );

  const { text } = await fetchText(`${server.baseUrl}/petitions`, {
    headers: { Cookie: authorSession.cookie },
  });
  const petitionMatch = text.match(/id="petition-([^"]+)"/);
  assert.ok(petitionMatch, 'expected petition id in HTML');
  const petitionId = petitionMatch[1];

  await postForm(
    `${server.baseUrl}/petitions/comment`,
    { petitionId, content: `@${authorHandle} Looks good.` },
    { cookie: commenterSession.cookie },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, authorSession.sessionId);
  await page.goto(`${server.baseUrl}/notifications`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('Mention in a proposal'));

  const initiallyChecked = await page.$eval('input[name="notifyProposalComments"]', (el) => el.checked);
  assert.equal(initiallyChecked, true);

  await page.click('input[name="notifyProposalComments"]');
  const prefResponse = page.waitForResponse((response) => response.url().endsWith('/notifications/preferences'));
  await page.click('form[action="/notifications/preferences"] button[type="submit"]');
  await prefResponse;

  await page.goto(`${server.baseUrl}/notifications`, { waitUntil: 'networkidle0' });
  const checkedAfter = await page.$eval('input[name="notifyProposalComments"]', (el) => el.checked);
  assert.equal(checkedAfter, false);

  const readResponse = page.waitForResponse((response) => response.url().endsWith('/notifications/read'));
  await page.click('form[action="/notifications/read"] button[type="submit"]');
  await readResponse;
  await page.waitForFunction(() => document.querySelector('main h1 + p')?.textContent === '0 unread');
  assert.equal(new URL(page.url()).pathname, '/notifications');
});

test('UI petition revisions and freeze state update', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const authorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'author-ui-revision' });
  const moderatorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'moderator-ui-revision' });

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: moderatorSession.sessionId, sessionRole: 'moderator' },
    { partial: true },
  );

  const draft = await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Revision Petition', summary: 'Initial summary', body: 'Initial body' },
    { cookie: authorSession.cookie },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const authorPage = await browser.newPage();
  await configurePage(authorPage, server.baseUrl);
  await setSessionCookie(authorPage, server.baseUrl, authorSession.sessionId);
  await authorPage.goto(draft.url, { waitUntil: 'networkidle0' });

  await authorPage.evaluate(() => {
    const details = Array.from(document.querySelectorAll('details.note')).find((node) =>
      node.querySelector('summary')?.textContent?.includes('Update draft'),
    );
    if (details) details.open = true;
  });

  const updateForm = await authorPage.$('form[action="/petitions/update"]');
  assert.ok(updateForm);
  const summaryField = await updateForm.$('textarea[name="summary"]');
  await summaryField.click({ clickCount: 3 });
  await summaryField.type('Revised summary');
  const noteField = await updateForm.$('input[name="note"]');
  if (noteField) {
    await noteField.type('Refined copy');
  }
  const updateButton = await updateForm.$('button[type="submit"]');
  await updateButton.click();
  await authorPage.waitForFunction(() => document.body.textContent.includes('Revisions: 2'));
  await authorPage.waitForFunction(() => document.body.textContent.includes('Revised summary'));

  const moderatorPage = await browser.newPage();
  await configurePage(moderatorPage, server.baseUrl);
  await setSessionCookie(moderatorPage, server.baseUrl, moderatorSession.sessionId);
  await moderatorPage.goto(draft.url, { waitUntil: 'networkidle0' });

  const statusForm = await moderatorPage.$('form[action="/petitions/status"]');
  assert.ok(statusForm);
  const statusSelect = await statusForm.$('select[name="status"]');
  await statusSelect.select('vote');
  const confirmFreeze = await statusForm.$('input[name="confirmFreeze"]');
  await confirmFreeze.click();
  const applyButton = await statusForm.$('button[type="submit"]');
  await applyButton.click();
  await moderatorPage.waitForFunction(() => document.body.textContent.includes('Frozen proposal text'));
  await moderatorPage.waitForSelector('nav[aria-label="Proposal sections"] [aria-current="page"][href*="view=ballot"]');
  assert.equal(await moderatorPage.$('form[action="/petitions/update"]'), null);
  await moderatorPage.click('a[href*="view=history#revision-"]');
  await moderatorPage.waitForSelector('nav[aria-label="Proposal sections"] [aria-current="page"][href*="view=history"]');
  const focused = await moderatorPage.evaluate(() => document.activeElement?.textContent);
  assert.match(focused, /Revision used for the ballot/);
});

test('UI groups open focused views after enhanced creation and ordinary HTML membership changes', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const memberSession = await createVerifiedSession(server.baseUrl, { pidHash: 'member-ui-group' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, memberSession.sessionId);
  await page.goto(`${server.baseUrl}/groups`, { waitUntil: 'networkidle0' });

  await page.type('form[action="/groups"] input[name="name"]', 'Public Healthcare Circle');
  await page.type('form[action="/groups"] input[name="topics"]', 'Healthcare, Healthcare / Waiting lists');
  await page.type('form[action="/groups"] textarea[name="description"]', 'Delegates and priorities on waiting times and healthcare work.');
  await page.click('form[action="/groups"] button.cta[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Public Healthcare Circle'));

  const groupId = new URL(page.url()).searchParams.get('group');
  assert.ok(groupId);
  await page.click('nav[aria-label="Group sections"] a[href$="view=members"]');
  await page.waitForSelector('[data-composer-section="group-members"]');
  await page.waitForFunction(() => document.activeElement === document.querySelector('main h1'));
  await page.setJavaScriptEnabled(false);
  await page.reload();
  const leaveAction = await page.$('form[action="/groups"] input[name="action"][value="leave"]');
  assert.ok(leaveAction);
  const leaveForm = await leaveAction.evaluateHandle((node) => node.closest('form'));
  const leaveButton = await leaveForm.$('button[type="submit"]');
  await Promise.all([page.waitForNavigation(), leaveButton.click()]);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'members');
  const joinAction = await page.$('form[action="/groups"] input[name="action"][value="join"]');
  assert.ok(joinAction);
  const joinForm = await joinAction.evaluateHandle((node) => node.closest('form'));
  const joinButton = await joinForm.$('button[type="submit"]');
  await Promise.all([page.waitForNavigation(), joinButton.click()]);
  assert.equal(new URL(page.url()).searchParams.get('group'), groupId);
  assert.ok(await page.$('input[name="action"][value="leave"]'));
});

test('UI admin can update rate limits and session overrides', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const adminSession = await createVerifiedSession(server.baseUrl, { pidHash: 'admin-ui' });
  const targetSession = await createVerifiedSession(server.baseUrl, { pidHash: 'target-ui' });

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: adminSession.sessionId, sessionRole: 'admin' },
    { partial: true },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, adminSession.sessionId);
  await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('Circle settings and policy'));

  const rateLimitForm = await getAdminForm(page, 'rate-limits');
  const overrides = 'discussion_post:60:1';
  const rateTextarea = await rateLimitForm.$('textarea[name="rateLimitOverrides"]');
  await rateTextarea.click({ clickCount: 3 });
  await rateTextarea.type(overrides);
  const rateResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const rateButton = await rateLimitForm.$('button[type="submit"]');
  await rateButton.click();
  await rateResponse;
  await page.waitForFunction(() => document.body.textContent.includes('Rate limits saved'));
  const overridesSaved = await page.$eval('textarea[name="rateLimitOverrides"]', (el) => el.value.trim());
  assert.equal(overridesSaved, overrides);

  const sessionForm = await getAdminForm(page, 'session');
  const sessionIdInput = await sessionForm.$('input[name="sessionId"]');
  await sessionIdInput.click({ clickCount: 3 });
  await sessionIdInput.type(targetSession.sessionId);
  const roleSelect = await sessionForm.$('select[name="sessionRole"]');
  await roleSelect.select('moderator');
  const sessionResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const sessionButton = await sessionForm.$('button[type="submit"]');
  await sessionButton.click();
  await sessionResponse;
  await page.waitForFunction((sessionId) => document.body.textContent.includes(sessionId), {}, targetSession.sessionId);
  const roleSelected = await page.$eval(
    'select[name="sessionRole"] option[value="moderator"]',
    (el) => el.selected,
  );
  assert.equal(roleSelected, true);
});

test('UI admin module toggles update navigation and access', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const adminSession = await createVerifiedSession(server.baseUrl, { pidHash: 'admin-ui-modules' });

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: adminSession.sessionId, sessionRole: 'admin' },
    { partial: true },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, adminSession.sessionId);
  await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle0' });

  const modulesForm = await getAdminForm(page, 'modules');
  const socialToggle = await modulesForm.$('input[name="module_social"]');
  const petitionsToggle = await modulesForm.$('input[name="module_petitions"]');
  assert.ok(socialToggle);
  assert.ok(petitionsToggle);
  if (await socialToggle.evaluate((el) => el.checked)) {
    await socialToggle.evaluate((el) => el.click());
  }
  if (await petitionsToggle.evaluate((el) => el.checked)) {
    await petitionsToggle.evaluate((el) => el.click());
  }

  const modulesResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const modulesButton = await modulesForm.$('button[type="submit"]');
  await modulesButton.click();
  await modulesResponse;
  await page.waitForFunction(() => document.body.textContent.includes('Module toggles updated'));

  await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await page.$('[data-nav-section="social"]'), null);
  assert.equal(await page.$('[data-nav-section="petitions"]'), null);

  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await page.$('[data-module-disabled="social"]'));

  await page.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await page.$('[data-module-disabled="petitions"]'));
});

test('UI admin reviews topic anchor suggestions and logs history', { timeout: 60000 }, async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpw-ui-anchors-'));
  const kvFile = path.join(tempDir, 'state.json');
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const now = new Date().toISOString();
  const seed = {
    topics: [
      {
        id: 'topic-climate',
        key: 'climate',
        label: 'Climate',
        slug: 'climate',
        pathKey: 'climate',
        depth: 0,
        aliases: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'topic-economy',
        key: 'economy',
        label: 'Economy',
        slug: 'economy',
        pathKey: 'economy',
        depth: 0,
        aliases: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: {
      initialized: true,
      topicGardener: {
        anchors: ['general', 'economy', 'society'],
        pinned: [],
        pendingAnchors: [
          {
            key: 'climate',
            label: 'Climate',
            action: 'promote',
            at: now,
            reason: 'count 14',
            source: 'gardener',
          },
          {
            key: 'economy',
            label: 'Economy',
            action: 'archive',
            at: now,
            reason: 'stale anchor',
            source: 'gardener',
          },
        ],
      },
    },
    meta: { schemaVersion: LATEST_SCHEMA_VERSION, migrations: [] },
  };
  await writeFile(kvFile, JSON.stringify(seed, null, 2));

  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'kv', kvFile });
  t.after(async () => server.stop());

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.textContent.includes('Anchor suggestions'));
  await page.waitForFunction(() => document.body.textContent.includes('Promote to anchor'));
  await page.waitForFunction(() => document.body.textContent.includes('Archive anchor'));

  const promoteForm = await getAdminFormByAction(page, { intent: 'topic-anchor-accept', action: 'promote' });
  assert.ok(promoteForm);
  const anchorLabel = await promoteForm.$('input[name="anchorLabel"]');
  assert.ok(anchorLabel);
  await anchorLabel.click({ clickCount: 3 });
  await anchorLabel.type('Climate');
  const promoteResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const promoteButton = await promoteForm.$('button[type="submit"]');
  await promoteButton.click();
  await promoteResponse;
  await page.waitForFunction(() => document.body.textContent.includes('Anchor "Climate" promoted'));

  const anchorsAfterPromote = await page.$eval('input[name="topicAnchors"]', (el) =>
    el.value.split(',').map((entry) => entry.trim().toLowerCase()),
  );
  assert.ok(anchorsAfterPromote.includes('climate'));
  await page.waitForFunction(() => document.body.textContent.includes('anchor_promote_accept'));

  const archiveForm = await getAdminFormByAction(page, { intent: 'topic-anchor-accept', action: 'archive' });
  assert.ok(archiveForm);
  const confirmArchive = await archiveForm.$('input[name="confirm"]');
  assert.ok(confirmArchive);
  await confirmArchive.click();
  const archiveResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const archiveButton = await archiveForm.$('button[type="submit"]');
  await archiveButton.click();
  await archiveResponse;
  await page.waitForFunction(() => document.body.textContent.includes('Anchor "Economy" archived'));

  const anchorsAfterArchive = await page.$eval('input[name="topicAnchors"]', (el) =>
    el.value.split(',').map((entry) => entry.trim().toLowerCase()),
  );
  assert.ok(!anchorsAfterArchive.includes('economy'));
  await page.waitForFunction(() => document.body.textContent.includes('anchor_archive_accept'));
  await page.waitForFunction(() => document.body.textContent.includes('No anchor suggestions'));
});

test('UI petition discussion exposes evidence prompt (agent viewport)', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'evidence-ui' });
  const draft = await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Evidence UI', summary: 'Testing evidence prompt', body: '' },
    { cookie: session.cookie },
  );

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, session.sessionId);
  await page.setJavaScriptEnabled(false);
  await page.goto(draft.url, { waitUntil: 'networkidle0' });
  const discussion = await page.$('nav[aria-label="Proposal sections"] a[href*="view=discussion"]');
  await Promise.all([page.waitForNavigation(), discussion.click()]);
  await page.$eval('#proposal-comment', (form) => form.scrollIntoView({ block: 'center' }));

  const snapshot = await captureViewport(page);
  assertSnapshot(snapshot, { target: { text: 'Evidence / citations' }, min: 1 });
  await page.type('#proposal-comment textarea[name="content"]', 'Attach the published waiting-list report.');
  await Promise.all([
    page.waitForNavigation(),
    page.click('#proposal-comment button[type="submit"]'),
  ]);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'discussion');
  assert.match(await page.$eval('#petitions-discussion', (panel) => panel.innerText), /Attach the published waiting-list report/);
});

// An expanded compose form is taller than a short viewport. Two layout choices break
// it, and both shipped at some point: capping the aside with overflow:auto clips the
// form so its submit button sits outside the rail's visible box, and making the aside
// (or the panel) sticky is worse, because a sticky element taller than the viewport
// pins at `top` and then stops moving, so nothing below the fold can be scrolled to.
// Either way the member simply cannot submit. Assert the button is genuinely reachable
// on every compose surface at a small viewport.
test('compose forms stay reachable at a short viewport', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  const session = await createVerifiedSession(server.baseUrl, { pidHash: 'compose-reach' });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  t.after(async () => {
    await browser.close();
    await server.stop();
  });

  const surfaces = [
    { url: '/discussion?compose=post', form: '#discussion-compose form' },
    { url: '/forum?compose=thread', form: 'form[action="/forum"]' },
    { url: '/petitions?compose=proposal', form: '#petitions-compose form' },
    { url: '/social/feed?compose=post', form: '#social-compose form' },
  ];

  for (const { url, form } of surfaces) {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await configurePage(page, server.baseUrl);
    await setSessionCookie(page, server.baseUrl, session.sessionId);
    await page.goto(`${server.baseUrl}${url}`, { waitUntil: 'networkidle0' });
    page.on('dialog', (dialog) => dialog.accept());

    const button = await page.$(`${form} button[type="submit"]`);
    assert.ok(button, `expected a submit button on ${url}`);

    // No ancestor may clip or pin the form out of reach.
    const trapped = await page.evaluate((formSelector) => {
      const el = document.querySelector(`${formSelector} button[type="submit"]`);
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const cs = getComputedStyle(node);
        const clips = cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden';
        const tallerThanViewport = node.getBoundingClientRect().height > window.innerHeight;
        if (cs.position === 'sticky' && tallerThanViewport) return `sticky ancestor taller than viewport: .${node.className}`;
        if (clips && node.scrollHeight > node.clientHeight) return `scroll-clipping ancestor: .${node.className}`;
      }
      return null;
    }, form);
    assert.equal(trapped, null, `${url}: ${trapped}`);

    // And the real proof: Puppeteer can scroll to it and click it.
    await button.click();
    await page.close();
  }
});

test('organization case details stay ahead of the queue and fit a phone viewport', { timeout: 30000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const { baseUrl } = server;
  const member = await createVerifiedSession(baseUrl, { pidHash: 'n-calabrese' });
  await postForm(baseUrl + '/discussion', {
    topic: 'Emergency Department / Admissions',
    content: 'At 03:40 we have 11 patients waiting for a bed, four for more than 24 hours.',
    evidenceLinks: 'https://example.org/asl-val-sereno/admissions-flow-and-weekend-bed-availability',
  }, member);
  const discussion = await fetchText(baseUrl + '/discussion', { headers: { Cookie: member.cookie } });
  const source = discussion.text.match(/href="\/organization\?source=([^"]+)"/);
  assert.ok(source);
  const opened = await postForm(baseUrl + '/organization', {
    intent: 'promote', sourceId: source[1], voiceType: 'need',
    summary: 'Weekend boarding in the Emergency Department',
    consequence: 'Triage staff must reassess patients while they wait for admission.',
  }, member);
  assert.equal(opened.status, 200);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await setSessionCookie(page, baseUrl, member.sessionId);
  await page.setViewport({ width: 390, height: 844 });
  await page.setJavaScriptEnabled(false);
  await page.goto(opened.url, { waitUntil: 'load' });
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    caseTop: document.querySelector('#organization-case-work').getBoundingClientRect().top,
    queueTop: document.querySelector('#organization-case-queue').getBoundingClientRect().top,
  }));
  assert.ok(layout.scrollWidth <= layout.width, 'the case and queue fit the viewport');
  assert.ok(layout.caseTop < layout.queueTop, 'the case precedes its queue');
});

test('Discussion search opens evidence and returns to the same filters with or without JavaScript', { timeout: 60000 }, async (t) => {
  const { baseUrl, stop } = await startServer({ port: await getAvailablePort(), extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const session = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const evidence = 'https://example.rcn.it/waiting-lists/survey-method';
  assert.equal((await postForm(`${baseUrl}/discussion`, {
    topic: 'Healthcare / Waiting lists',
    content: 'The cardiology waiting time is a median from 14 health authorities.',
    evidenceLinks: evidence,
  }, session)).status, 200);
  assert.equal((await postForm(`${baseUrl}/discussion`, {
    topic: 'Labour / Minimum wage',
    content: 'The CNEL figures show why collective-agreement coverage matters.',
  }, session)).status, 200);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 700 });
  const filters = '#discussion-filters';
  const result = '#discussion-feed .contribution-link';
  const query = 'survey-method';
  for (const enhanced of [true, false]) {
    await page.setJavaScriptEnabled(enhanced);
    await page.goto(`${baseUrl}/discussion`);
    await page.focus(`${filters} summary`);
    await page.keyboard.press('Enter');
    await page.type(`${filters} input[type="search"]`, query);
    await page.select(`${filters} select[name="topic"]`, 'Healthcare');
    await page.click(`${filters} button[type="submit"]`);
    await page.waitForFunction((q) => new URL(location.href).searchParams.get('q') === q, {}, query);
    assert.equal((await page.$$(result)).length, 1);
    await page.focus(result);
    await page.keyboard.press('Enter');
    // The collection card already carries the evidence link, so wait for the
    // destination heading before asserting: the enhanced swap may still be in flight.
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Healthcare / Waiting lists');
    await page.waitForSelector(`main .topic-card a[href="${evidence}"]`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    if (enhanced) assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
    await page.goBack();
    await page.waitForSelector(result);
    assert.equal(await page.$eval(`${filters} input[type="search"]`, (input) => input.value), query);
    assert.equal(await page.$eval(`${filters} select[name="topic"]`, (select) => select.value), 'Healthcare');
  }
});

test('Forum preserves the search and article through enhanced and native reply forms', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const session = await createVerifiedSession(baseUrl, { pidHash: 'sofia-bianchi' });
  const article = await postForm(`${baseUrl}/forum`, {
    title: 'Why software cannot engineer around the free-mandate rule',
    topic: 'Institutions / Free mandate',
    content: 'Art. 67 Cost. guarantees a free mandate.',
  }, session);
  const articleUrl = new URL(article.url);
  assert.ok(articleUrl.searchParams.get('thread'));
  articleUrl.searchParams.set('q', 'free mandate');

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 700 });
  await setSessionCookie(page, baseUrl, session.sessionId);
  await page.goto(`${baseUrl}/forum`);
  await page.type('input[name="q"]', 'free mandate');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => new URL(location.href).searchParams.has('q'));
  await page.waitForSelector('#forum-threads h3 a');
  await page.focus('#forum-threads h3 a');
  await page.keyboard.press('Enter');
  await page.waitForFunction((url) => location.href === url && document.activeElement?.tagName === 'H1', {}, articleUrl.href);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.goBack();
  await page.waitForSelector('#forum-threads h3 a');
  assert.equal(await page.$eval('input[name="q"]', (input) => input.value), 'free mandate');
  await page.click('#forum-threads h3 a');
  await page.waitForSelector('#forum-reply');

  const field = '#forum-reply textarea[name="content"]';
  await page.type(field, 'How does the pact differ from a party whip?');
  await page.click('#forum-reply button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#forum-replies .reply-card')?.textContent.includes('party whip'));
  assert.equal(page.url(), articleUrl.href);

  await page.setJavaScriptEnabled(false);
  await page.reload();
  await page.type(field, 'The seat stays yours either way.');
  await Promise.all([
    page.waitForNavigation(),
    page.click('#forum-reply button[type="submit"]'),
  ]);
  assert.equal(page.url(), articleUrl.href);
  assert.deepEqual(await page.$$eval('#forum-replies .reply-card__text', (nodes) => nodes.map((node) => node.textContent)), [
    'How does the pact differ from a party whip?',
    'The seat stays yours either way.',
  ]);
  await Promise.all([page.waitForNavigation(), page.click('.forum-reading > a')]);
  assert.equal(await page.$eval('input[name="q"]', (input) => input.value), 'free mandate');
});
