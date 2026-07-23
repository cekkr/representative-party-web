#!/usr/bin/env node
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

import { getAvailablePort, startServer } from '../tests/helpers/server.js';
import { createVerifiedSession } from '../tests/helpers/auth.js';
import { postForm, fetchText } from '../tests/helpers/http.js';
import { captureViewport, renderAsText } from './agent-viewport.js';

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
    const session = await createVerifiedSession(baseUrl, { pidHash: 'smoke-ui' });

    await postForm(
      `${baseUrl}/forum`,
      { title: 'Smoke thread', content: 'Hello from smoke check.' },
      { cookie: session.cookie },
    );

    const { text } = await fetchText(`${baseUrl}/forum`, {
      headers: { Cookie: session.cookie },
    });
    const threadMatch = text.match(/id=\"thread-([^\"]+)\"/);
    if (!threadMatch) {
      throw new Error('Smoke check failed: could not parse forum thread id.');
    }
    const threadId = threadMatch[1];

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

    // `/` is an operational workspace, not a feed redirect: a verified session used to
    // be bounced to /social/feed, and that was deliberately removed (see ROADMAP).
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
    assert.ok(!page.url().includes('/social/feed'), 'Expected / to stay on the workspace, not redirect to the feed');
    await assertNavState(page, { section: 'home', activeLabel: 'Home', childrenKey: 'home' });
    await maybeDumpViewport(page, 'home');

    await page.goto(`${baseUrl}/social/feed`, { waitUntil: 'networkidle0' });
    await assertNavState(page, { section: 'social', activeLabel: 'Social feed', childrenKey: 'social' });
    await maybeDumpViewport(page, 'wall');

    await page.goto(`${baseUrl}/discussion?compose=post`, { waitUntil: 'networkidle0' });
    await assertNavState(page, { section: 'discussion', activeLabel: 'Discussion', childrenKey: 'discussion' });
    await assertDetailsOpen(page, '#discussion-compose details.form-toggle');
    await maybeDumpViewport(page, 'discussion-compose');

    await page.goto(`${baseUrl}/petitions?compose=proposal`, { waitUntil: 'networkidle0' });
    await assertNavState(page, { section: 'petitions', activeLabel: 'Proposals', childrenKey: 'petitions' });
    await assertDetailsOpen(page, '#petitions-compose details.form-toggle');

    await page.goto(`${baseUrl}/forum?compose=thread`, { waitUntil: 'networkidle0' });
    await assertNavState(page, { section: 'forum', activeLabel: 'Forum', childrenKey: 'forum' });
    await assertDetailsOpen(page, '#forum-compose details.form-toggle');

    await page.goto(`${baseUrl}/forum?reply=${encodeURIComponent(threadId)}#thread-${threadId}`, {
      waitUntil: 'networkidle0',
    });
    await assertDetailsOpen(page, `#thread-${threadId} details.reply-composer`);

    console.log('UI smoke check passed.');
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
}

async function assertNavState(page, { section, activeLabel, childrenKey }) {
  const state = await page.evaluate((key) => {
    const active = document.querySelector('.side-nav__item.is-active [data-nav-link]');
    const childBlock = document.querySelector(`[data-nav-children=\"${key}\"]`);
    return {
      section: document.body.dataset.section || '',
      activeLabel: active?.textContent?.trim() || '',
      childrenVisible: childBlock ? childBlock.hidden === false : false,
    };
  }, childrenKey);
  assert.equal(state.section, section);
  assert.equal(state.activeLabel, activeLabel);
  assert.equal(state.childrenVisible, true);
}

async function assertDetailsOpen(page, selector) {
  const isOpen = await page.evaluate((sel) => {
    const details = document.querySelector(sel);
    return details ? details.open === true : false;
  }, selector);
  assert.equal(isOpen, true, `Expected ${selector} to be open.`);
}

async function maybeDumpViewport(page, label) {
  if (!SHOULD_DUMP) return;
  const snapshot = await captureViewport(page, { mode: 'balanced' });
  console.log(`\\nVIEWPORT ${label}:\\n${renderAsText(snapshot)}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
