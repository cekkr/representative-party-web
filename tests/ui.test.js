import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';
import { LATEST_SCHEMA_VERSION } from '../src/infra/persistence/migrations.js';

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

async function expectDialog(page, action, matcher) {
  let message = '';
  page.once('dialog', async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  await action();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(message, matcher);
}

async function getAdminForm(page, intent) {
  const intentSelector = `form[action="/admin"] input[name="intent"][value="${intent}"]`;
  const intentField = await page.$(intentSelector);
  assert.ok(intentField, `expected admin form for ${intent}`);
  return intentField.evaluateHandle((node) => node.closest('form'));
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
  const background = await guestPage.evaluate(() => window.getComputedStyle(document.body).backgroundImage || '');
  assert.ok(background.includes('gradient') || background.includes('radial-gradient'));

  await guestPage.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await guestPage.type('input[name="topic"]', 'Access');
  await guestPage.type('textarea[name="content"]', 'Guest post attempt');
  await expectDialog(
    guestPage,
    () => guestPage.click('button[type="submit"]'),
    /verification|required|blocked/i,
  );

  const personPage = await personContext.newPage();
  await configurePage(personPage, server.baseUrl);
  await setSessionCookie(personPage, server.baseUrl, personSession.sessionId);
  await personPage.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await personPage.type('input[name="topic"]', 'Energy');
  await personPage.type('textarea[name="content"]', 'Person post');
  await personPage.click('button[type="submit"]');
  await personPage.waitForFunction(() => document.body.textContent.includes('Person post'));

  await personPage.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  await personPage.type('input[name="title"]', 'UI Petition');
  await personPage.type('textarea[name="summary"]', 'Testing petition flow');
  await personPage.click('button[type="submit"]');
  await personPage.waitForFunction(() => document.body.textContent.includes('UI Petition'));
  const moderationForm = await personPage.$('form[action="/petitions/status"]');
  assert.equal(moderationForm, null);

  const moderatorPage = await moderatorContext.newPage();
  await configurePage(moderatorPage, server.baseUrl);
  await setSessionCookie(moderatorPage, server.baseUrl, moderatorSession.sessionId);
  await moderatorPage.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  await moderatorPage.waitForFunction(() => document.body.textContent.includes('UI Petition'));
  const moderatorForm = await moderatorPage.$('form[action="/petitions/status"]');
  assert.ok(moderatorForm);

  const bannedPage = await bannedContext.newPage();
  await configurePage(bannedPage, server.baseUrl);
  await setSessionCookie(bannedPage, server.baseUrl, bannedSession.sessionId);
  await bannedPage.goto(`${server.baseUrl}/discussion`, { waitUntil: 'networkidle0' });
  await bannedPage.type('input[name="topic"]', 'Ban');
  await bannedPage.type('textarea[name="content"]', 'Banned post attempt');
  await expectDialog(
    bannedPage,
    () => bannedPage.click('button[type="submit"]'),
    /banned/i,
  );

  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'modules', module_delegation: 'on', module_federation: 'on', module_topicGardener: 'on' },
    { partial: true },
  );

  await guestPage.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await guestPage.$('a[data-nav="social"]'), null);
  assert.equal(await guestPage.$('a[data-nav="petitions"]'), null);
  assert.equal(await guestPage.$('a[data-nav="groups"]'), null);

  await guestPage.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await guestPage.$('[data-module-disabled="social"]'));

  await guestPage.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await guestPage.$('[data-module-disabled="petitions"]'));
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

  await page.type('form[action="/social/follow"] input[name="handle"]', bobHandle);
  await page.type('form[action="/social/follow"] input[name="type"]', 'interest');
  await page.click('form[action="/social/follow"] button[type="submit"]');
  await page.waitForFunction((handle) => document.body.textContent.includes(handle), {}, bobHandle);
  await page.waitForFunction(() => document.body.textContent.includes('Bob update for follow'));
  await page.waitForFunction(() => document.body.textContent.includes('Follow: interest'));

  await page.select('form[action="/social/feed"] select[name="type"]', 'alerts');
  await page.click('form[action="/social/feed"] button[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('No posts yet'));

  await page.select('form[action="/social/feed"] select[name="type"]', 'interest');
  await page.click('form[action="/social/feed"] button[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Bob update for follow'));

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
    extraEnv: { SOCIAL_MEDIA_REPORT_THRESHOLD: '1' },
  });
  t.after(async () => server.stop());

  const authorSession = await createVerifiedSession(server.baseUrl, { pidHash: 'media-ui-author' });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  t.after(async () => browser.close());

  const page = await browser.newPage();
  await configurePage(page, server.baseUrl);
  await setSessionCookie(page, server.baseUrl, authorSession.sessionId);
  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });

  await page.type('form[action="/social/post"] textarea[name="content"]', 'Media post with locked view');
  const fileInput = await page.$('form[action="/social/post"] input[name="media"]');
  assert.ok(fileInput);
  await fileInput.uploadFile(mediaPath);
  await page.click('form[action="/social/post"] button[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Locked media'));

  const requestHref = await page.$eval(
    'a[href^="/social/media/"][href*="view=1"]',
    (node) => node.getAttribute('href'),
  );
  assert.ok(requestHref);
  const mediaId = requestHref.split('/').pop().split('?')[0];
  assert.ok(mediaId);

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

  await page.click('form[data-enhance="social-media-report"] button[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Blocked media'));
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
  await page.waitForFunction(() => document.body.textContent.includes('Mention in proposal'));

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
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('span.pill.ghost')).some((el) => el.textContent.trim() === 'read'),
  );
});

test('UI groups allow creation and join/leave flows', { timeout: 60000 }, async (t) => {
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

  await page.type('form[action="/groups"] input[name="name"]', 'Energy Circle');
  await page.type('form[action="/groups"] input[name="topics"]', 'energy,climate');
  await page.type('form[action="/groups"] textarea[name="description"]', 'Group for UI coverage.');
  await page.click('form[action="/groups"] button.cta[type="submit"]');
  await page.waitForFunction(() => document.body.textContent.includes('Energy Circle'));

  const leaveAction = await page.$('form[action="/groups"] input[name="action"][value="leave"]');
  assert.ok(leaveAction);
  const leaveForm = await leaveAction.evaluateHandle((node) => node.closest('form'));
  const leaveButton = await leaveForm.$('button[type="submit"]');
  await leaveButton.click();
  await page.waitForFunction(() => document.querySelector('form[action="/groups"] input[name="action"][value="join"]'));
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
    await socialToggle.click();
  }
  if (await petitionsToggle.evaluate((el) => el.checked)) {
    await petitionsToggle.click();
  }

  const modulesResponse = page.waitForResponse(
    (response) => response.url().endsWith('/admin') && response.request().method() === 'POST',
  );
  const modulesButton = await modulesForm.$('button[type="submit"]');
  await modulesButton.click();
  await modulesResponse;
  await page.waitForFunction(() => document.body.textContent.includes('Module toggles updated'));

  await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await page.$('a[data-nav="social"]'), null);
  assert.equal(await page.$('a[data-nav="petitions"]'), null);

  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  assert.ok(await page.$('[data-module-disabled="social"]'));

  await page.goto(`${server.baseUrl}/petitions`, { waitUntil: 'networkidle0' });
  assert.ok(await page.$('[data-module-disabled="petitions"]'));
});
