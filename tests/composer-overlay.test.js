import { test } from 'node:test';
import assert from 'node:assert/strict';

import puppeteer from 'puppeteer';

import { createVerifiedSession } from './helpers/auth.js';
import { postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

/**
 * The admin composer tool is a fixed-position frame that stays as tall as its
 * collapsed panel. When the frame itself took pointer events it silently
 * swallowed clicks on everything beneath it — including the social composer, so
 * an admin could not post at all.
 */
async function controlsCoveredByComposerTool(page) {
  return page.evaluate(() => {
    const tool = document.querySelector('.composer-tool');
    if (!tool) return null;
    const covered = [];
    const selector = 'a[href], button, input, select, textarea, summary';
    for (const el of document.querySelectorAll(selector)) {
      if (tool.contains(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.top < 0 || rect.bottom > window.innerHeight) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit && tool.contains(hit)) {
        covered.push(`${el.tagName.toLowerCase()}: ${(el.textContent || '').trim().slice(0, 40)}`);
      }
    }
    return covered;
  });
}

test('collapsed composer tool does not swallow clicks on the page', { timeout: 60000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const admin = await createVerifiedSession(server.baseUrl, { pidHash: 'composer-admin' });
  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: admin.sessionId, sessionRole: 'admin' },
    { partial: true },
  );

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  t.after(async () => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({
    name: 'circle_session',
    value: admin.sessionId,
    url: server.baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
  });

  for (const route of ['/', '/social/feed', '/organization']) {
    await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'networkidle0' });
    const covered = await controlsCoveredByComposerTool(page);
    assert.ok(covered, `expected the composer tool to render for an admin on ${route}`);
    assert.deepEqual(covered, [], `composer tool must not cover controls on ${route}`);
  }

  // The social composer must actually accept input for an admin.
  await page.goto(`${server.baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
  const textarea = await page.$('.composer__input textarea');
  assert.ok(textarea, 'expected the social composer textarea');
  await textarea.click();
  await page.keyboard.type('Admin can reach the composer.');
  const typed = await page.evaluate(() => document.querySelector('.composer__input textarea')?.value || '');
  assert.equal(typed, 'Admin can reach the composer.', 'composer must receive typed input');

  // The tool itself must still open.
  await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => document.body.dataset.composerMode), 'off');
  await page.click('.composer-tool__bar button');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await page.evaluate(() => document.body.dataset.composerMode),
    'on',
    'the composer bar must still toggle composer mode',
  );
  const panelUsable = await page.evaluate(() => {
    const panel = document.querySelector('.composer-tool__panel');
    const rect = panel.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return panel.contains(hit);
  });
  assert.equal(panelUsable, true, 'the open composer panel must be interactive');
});
