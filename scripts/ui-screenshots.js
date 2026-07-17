#!/usr/bin/env node
/**
 * ui-screenshots
 * --------------
 * Drives a running deployment with Puppeteer and captures one screenshot per
 * route. Used to review UX and to refresh the images embedded in README.md.
 *
 *   BASE_URL=http://127.0.0.1:3000 SESSION=admin node scripts/ui-screenshots.js
 *
 * Options (env):
 *   BASE_URL   deployment to capture (default http://127.0.0.1:3000)
 *   SESSION    session id to set as the circle_session cookie (default admin)
 *   OUT_DIR    output directory (default .local/screenshots)
 *   WIDTH      viewport width (default 1440)
 *   HEIGHT     viewport height (default 900)
 *   SCALE      device scale factor (default 2; use 1 for lighter README assets)
 *   FULL       "1" to capture full scroll height instead of the viewport
 *   ONLY       comma-separated route names to limit the run
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import puppeteer from 'puppeteer';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SESSION = process.env.SESSION || 'admin';
const OUT_DIR = process.env.OUT_DIR || '.local/screenshots';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);
const SCALE = Number(process.env.SCALE || 2);
const FULL = process.env.FULL === '1';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

const ROUTES = [
  { name: 'home', url: '/' },
  { name: 'organization', url: '/organization' },
  { name: 'social', url: '/social/feed' },
  { name: 'discussion', url: '/discussion' },
  { name: 'forum', url: '/forum' },
  { name: 'petitions', url: '/petitions' },
  { name: 'delegation', url: '/delegation' },
  { name: 'delegates', url: '/delegates' },
  { name: 'groups', url: '/groups' },
  { name: 'governance', url: '/governance' },
  { name: 'notifications', url: '/notifications' },
  { name: 'profile', url: '/profile' },
  { name: 'transactions', url: '/transactions' },
  { name: 'extensions', url: '/extensions' },
  { name: 'admin', url: '/admin' },
];

/** Collects layout defects that a screenshot alone would not make obvious. */
async function auditPage(page) {
  return page.evaluate(() => {
    const problems = [];
    const docWidth = document.documentElement.clientWidth;

    if (document.documentElement.scrollWidth > docWidth + 1) {
      problems.push({
        kind: 'page-h-scroll',
        detail: `document scrollWidth ${document.documentElement.scrollWidth} > viewport ${docWidth}`,
      });
    }

    for (const el of document.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const cls = (el.className || '').toString().slice(0, 60);
      const style = getComputedStyle(el);

      // Content clipped by an ancestor with no way to reach it.
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX === 'hidden') {
        problems.push({
          kind: 'clipped-x',
          detail: `<${el.tagName.toLowerCase()} class="${cls}"> content ${el.scrollWidth}px in ${el.clientWidth}px, overflow-x:hidden`,
        });
      }

      // Scrollable strip with no visible affordance.
      if (el.scrollWidth > el.clientWidth + 40 && style.overflowX === 'auto') {
        problems.push({
          kind: 'silent-x-scroll',
          detail: `<${el.tagName.toLowerCase()} class="${cls}"> ${el.scrollWidth}px of content in a ${el.clientWidth}px strip`,
        });
      }
    }

    // Controls that are visible but whose clicks something else intercepts.
    // Panels that are merely closed (opacity 0, hidden) are not defects.
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.top < 0 || rect.bottom > window.innerHeight) continue;
      if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      problems.push({
        kind: 'click-blocked',
        detail: `<${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 30)}" is covered by <${hit.tagName.toLowerCase()} class="${(hit.className || '').toString().slice(0, 40)}">`,
      });
    }

    return problems;
  });
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const report = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
    await page.setCookie({
      name: 'circle_session',
      value: SESSION,
      url: BASE_URL,
      httpOnly: true,
      sameSite: 'Lax',
    });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const routes = ONLY.length ? ROUTES.filter((r) => ONLY.includes(r.name)) : ROUTES;

    for (const route of routes) {
      consoleErrors.length = 0;
      const response = await page.goto(`${BASE_URL}${route.url}`, { waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 250));

      const file = path.join(OUT_DIR, `${route.name}.png`);
      await page.screenshot({ path: file, fullPage: FULL });

      const problems = await auditPage(page);
      const title = await page.title();
      report.push({
        name: route.name,
        url: route.url,
        status: response ? response.status() : 0,
        title,
        file,
        consoleErrors: [...consoleErrors],
        problems,
      });
      console.log(`${String(response?.status() ?? '---').padEnd(4)} ${route.url.padEnd(18)} -> ${file}`);
      for (const p of problems) console.log(`       ! ${p.kind}: ${p.detail}`);
      for (const e of consoleErrors) console.log(`       ! console: ${e}`);
    }

    await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
