#!/usr/bin/env node
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

import { getAvailablePort, startServer } from '../tests/helpers/server.js';
import { createVerifiedSession } from '../tests/helpers/auth.js';
import { postForm } from '../tests/helpers/http.js';
import { assertSnapshot, captureViewport, renderAsText } from './agent-viewport.js';

const SHOULD_DUMP = process.env.SMOKE_DUMP === '1';
const HEADLESS = process.env.HEADLESS === 'false' ? false : 'new';

async function run() {
  let server;
  let baseUrl = (process.env.BASE_URL || '').trim();
  if (!baseUrl) {
    const port = await getAvailablePort();
    server = await startServer({ port, dataAdapter: 'memory' });
    baseUrl = server.baseUrl;
  } else if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  let browser;
  try {
    const session = await createVerifiedSession(baseUrl, { pidHash: 'composer-smoke' });
    const sample = {
      composerThemeCss: ':root { --composer-test-flag: 123; }',
      composerQuickActionsOrder: 'forum, social, home, notifications, profile, auth',
      composerSideNavOrder: 'forum, discussion, social, home, auth, profile, notifications, petitions, governance, delegation, groups, admin, health',
      composerAsideWidth: '420',
    };

    await postForm(
      `${baseUrl}/admin`,
      { intent: 'composer', ...sample },
      { cookie: session.cookie },
    );

    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setCookie({
      name: 'circle_session',
      value: session.sessionId,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    });

    await page.goto(`${baseUrl}/admin#composer`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      const section = document.querySelector('#composer');
      section?.scrollIntoView({ block: 'start' });
    });
    await delay(200);

    const formValues = await page.evaluate(() => {
      const readValue = (name) => document.querySelector(`[name="${name}"]`)?.value || '';
      return {
        quickActionsOrder: readValue('composerQuickActionsOrder'),
        sideNavOrder: readValue('composerSideNavOrder'),
        asideWidth: readValue('composerAsideWidth'),
        themeCss: readValue('composerThemeCss'),
      };
    });
    assert.equal(formValues.quickActionsOrder, sample.composerQuickActionsOrder);
    assert.equal(formValues.sideNavOrder, sample.composerSideNavOrder);
    assert.equal(formValues.asideWidth, sample.composerAsideWidth);
    assert.ok(formValues.themeCss.includes('--composer-test-flag: 123'));

    const cssFlag = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--composer-test-flag').trim(),
    );
    assert.equal(cssFlag, '123');

    const asideWidth = await page.evaluate(() => document.body.style.getPropertyValue('--page-aside-width').trim());
    assert.equal(asideWidth, '420px');

    const quickLabels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.quick-nav .quick-link'))
        .filter((link) => !link.classList.contains('quick-link--context'))
        .map((link) => link.textContent.trim())
        .filter(Boolean),
    );
    assert.equal(quickLabels[0], 'Forum');
    assert.equal(quickLabels[1], 'Wall');

    const conversationLabels = await page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('.side-nav__group'));
      const group = groups.find((item) => item.querySelector('.eyebrow')?.textContent.trim() === 'Conversation');
      return group ? Array.from(group.querySelectorAll('.side-nav__link')).map((link) => link.textContent.trim()) : [];
    });
    assert.deepEqual(conversationLabels.slice(0, 3), ['Forum', 'Discussion', 'Wall']);

    const snapshot = await captureViewport(page, { mode: 'balanced' });
    assertSnapshot(snapshot, [
      { id: 'composer-heading', target: { text: 'Theme + layout composer' }, min: 1 },
    ]);
    if (SHOULD_DUMP) {
      console.log(`\nCOMPOSER VIEWPORT:\n${renderAsText(snapshot)}`);
    }

    console.log('Composer UI smoke check passed.');
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
