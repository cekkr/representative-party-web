import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer';

import { createVerifiedSession } from './helpers/auth.js';
import { postForm } from './helpers/http.js';
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
