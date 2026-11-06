import { test } from 'node:test';
import assert from 'node:assert/strict';

import puppeteer from 'puppeteer';

import { createVerifiedSession } from './helpers/auth.js';
import { postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

/**
 * Control theming used to be keyed on the `.field` wrapper class, so any control
 * rendered outside one — the vote choice, the moderation status, group policy —
 * kept the browser's opaque white default in a dark UI. Assert by computed
 * style rather than by selector, so the next control added outside a `.field`
 * is caught too.
 */
async function lightControls(page) {
  return page.evaluate(() => {
    const offenders = [];
    const controls = document.querySelectorAll(
      'main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main select, main textarea',
    );
    for (const el of controls) {
      const match = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!match) continue;
      const [r, g, b, a = '1'] = match[1].split(',').map((n) => parseFloat(n));
      if (r > 200 && g > 200 && b > 200 && a > 0.5) {
        offenders.push(`<${el.tagName.toLowerCase()} name="${el.name || ''}">`);
      }
    }
    return offenders;
  });
}

test('form controls inherit the app theme on every lane', { timeout: 90000 }, async (t) => {
  const port = await getAvailablePort();
  const server = await startServer({ port, dataAdapter: 'memory' });
  t.after(async () => server.stop());

  const admin = await createVerifiedSession(server.baseUrl, { pidHash: 'theme-admin' });
  await postForm(
    `${server.baseUrl}/admin`,
    { intent: 'session', sessionId: admin.sessionId, sessionRole: 'admin' },
    { partial: true },
  );

  // A proposal in the vote stage renders the choice + moderation controls that
  // sat outside a `.field` and so went unthemed.
  const drafted = await postForm(
    `${server.baseUrl}/petitions`,
    { title: 'Theme check', summary: 'Ensure vote controls are themed.', quorum: '1' },
    { cookie: admin.cookie, partial: true },
  );
  assert.ok(drafted.ok, `expected the proposal draft to be accepted, got ${drafted.status}`);
  const petitionId = ((await drafted.text()).match(/id="petition-([^"]+)"/) || [])[1];
  assert.ok(petitionId, 'expected a drafted proposal to render');
  await postForm(
    `${server.baseUrl}/petitions/status`,
    { petitionId, status: 'vote', quorum: '1', confirmFreeze: 'yes' },
    { cookie: admin.cookie, partial: true },
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

  const ballotRoute = `/petitions?proposal=${petitionId}&view=ballot`;
  for (const route of ['/petitions', ballotRoute, '/groups', '/delegation', '/discussion', '/profile', '/admin']) {
    await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'networkidle0' });
    assert.deepEqual(await lightControls(page), [], `unthemed controls on ${route}`);
  }

  // The vote control specifically: it is the one a member uses to decide.
  await page.goto(`${server.baseUrl}${ballotRoute}`, { waitUntil: 'networkidle0' });
  const voteSelect = await page.$('form[action="/petitions/vote"] select[name="choice"]');
  assert.ok(voteSelect, 'expected a vote choice control on a proposal in the vote stage');
});
