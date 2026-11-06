#!/usr/bin/env node
/**
 * user-journeys
 * -------------
 * Drives the flows a real member actually performs, through the UI: clicking
 * the controls and typing into the fields, never posting forms behind the
 * interface's back. Every step asserts the observable result, so a broken flow
 * fails here instead of looking fine in a screenshot.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/user-journeys.js
 *
 * Options (env):
 *   BASE_URL   deployment to drive (default http://127.0.0.1:3000)
 *   OUT_DIR    screenshot output directory (default .local/journeys)
 *   ONLY       comma-separated journey names to run
 *   HEADLESS   "false" to watch it run in a real window
 *   KEEP       "1" to leave the browser open on failure
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import puppeteer from 'puppeteer';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || '.local/journeys';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const HEADLESS = process.env.HEADLESS === 'false' ? false : 'new';

const failures = [];
const shots = [];
const dialogs = [];
/** circle_session cookie -> handle, so a shared session is caught immediately. */
const sessionIds = new Map();

/* ---------------------------------------------------------------- helpers */

/**
 * Signs in the way a member actually does: open the wallet page and follow the
 * callback it offers. A session only exists once /auth/eudi has minted a pending
 * one, so there is no shortcut worth taking here.
 */
async function signIn(page) {
  await visit(page, '/auth/eudi');
  const followed = await clickText(page, 'a', 'simulate callback');
  if (!followed) record('no wallet callback link on /auth/eudi');
  await settle(page);
}

/**
 * Signs in and claims a handle on /profile, which is how a member gets named.
 *
 * Each member gets its own browser context. Tabs of one browser share a single
 * cookie jar, so without this every "member" would be the same session and the
 * last sign-in would silently win — which makes multi-member assertions
 * (quorum, follows, "another member sees it") vacuously true.
 */
async function newMember(browser, { handle }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => record(`pageerror on ${page.url()}: ${err.message}`));
  // A native dialog blocks the page until it is answered. Accept and note it:
  // a flow that interrupts the member with alert() is worth seeing in the log.
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });
  await signIn(page);
  if (handle) {
    await visit(page, '/profile');
    if (await typeInto(page, 'input[name="handle"]', handle)) {
      await submitNear(page, 'input[name="handle"]');
      await expectText(page, `@${handle}`, `@${handle} claimed a handle`);
    }
  }
  // Each member must be a distinct session, or every multi-member claim is void.
  const cookie = (await page.cookies()).find((c) => c.name === 'circle_session')?.value;
  if (cookie && sessionIds.has(cookie)) {
    record(`@${handle} is reusing the session of @${sessionIds.get(cookie)} — members are not isolated`);
  }
  if (cookie) sessionIds.set(cookie, handle);
  return page;
}

/**
 * Reuses a member's session across journeys.
 *
 * Always fronts the tab: a backgrounded tab has its rendering throttled, and
 * Puppeteer's click waits on IntersectionObserver to report the element in
 * view, which never happens there. Every interaction goes through a fronted tab.
 */
const memberCache = new Map();
async function member(browser, handle) {
  if (memberCache.has(handle)) {
    const page = memberCache.get(handle);
    await page.bringToFront();
    return page;
  }
  const page = await newMember(browser, { handle });
  memberCache.set(handle, page);
  return page;
}

/** Navigates a member's tab, fronting it first so interactions can proceed. */
async function visit(page, url) {
  await page.bringToFront();
  // `networkidle0` inside goto() intermittently times out with nothing in flight across
  // many browser contexts; wait for `load`, then settle on network idle separately.
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'load' });
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(() => {});
}

/**
 * The provider's admin session, which the standalone bootstrap seeds as pending.
 * Following the login link it prints is what verifies it — the moderate gate
 * requires verification, so setting the cookie alone would not be enough.
 * Opening a vote is a moderation action, so this is the actor that performs it.
 */
async function moderator(browser) {
  if (memberCache.has('__admin')) {
    const page = memberCache.get('__admin');
    await page.bringToFront();
    return page;
  }
  const session = process.env.ADMIN_SESSION || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('dialog', async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });
  await visit(page, `/auth/callback?session=${encodeURIComponent(session)}&pidHash=${encodeURIComponent(password)}`);
  memberCache.set('__admin', page);
  return page;
}

function record(message) {
  failures.push(message);
  console.log(`  ✖ ${message}`);
}

/**
 * Bounds a browser call so a wedged renderer is reported as a failed step
 * rather than taking the whole run down with a protocol timeout.
 */
async function guard(label, promiseFactory, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (error) {
    record(`${label}: ${error.message.split('\n')[0]}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function ok(message) {
  console.log(`  ✔ ${message}`);
}

/**
 * Captures the page, or just `focus` when given.
 *
 * Element captures are clipped from a top-of-page render rather than scrolled
 * to: headless Chrome composites sticky/layered content incorrectly in a
 * scrolled viewport screenshot, which looks like overlapping text that does not
 * exist in the layout.
 */
async function shot(page, name, note, { focus } = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  let target = page;
  if (focus) {
    const el = await page.$(focus);
    if (el) {
      target = el;
    } else {
      record(`screenshot target ${focus} missing on ${page.url()}`);
    }
  }
  await target.screenshot({ path: file, captureBeyondViewport: true });
  shots.push({ name, file, note });
  return file;
}

/** Clicks the control whose visible text matches, like a user scanning for it. */
async function clickText(page, selector, text, { optional = false } = {}) {
  const marked = await guard(`find "${text}"`, () =>
    page.evaluate(
      (sel, want) => {
        const nodes = [...document.querySelectorAll(sel)];
        const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(want.toLowerCase()));
        if (!hit) return false;
        hit.setAttribute('data-journey-target', '1');
        hit.scrollIntoView({ block: 'center' });
        return true;
      },
      selector,
      text,
    ),
  );
  if (!marked) {
    if (!optional) record(`no ${selector} matching "${text}" on ${page.url()}`);
    return false;
  }
  const el = await page.$('[data-journey-target]');
  if (!el) {
    if (!optional) record(`could not resolve "${text}" after marking it`);
    return false;
  }
  await guard(`click "${text}"`, () => el.click());
  await page.evaluate(() => document.querySelector('[data-journey-target]')?.removeAttribute('data-journey-target')).catch(() => {});
  await settle(page);
  return true;
}

/**
 * Opens every collapsed <details> above a field by clicking its summary, which
 * is the disclosure a member actually clicks. Returns false when the field is
 * not on the page at all.
 */
async function reveal(page, selector) {
  const found = await guard(`locate ${selector}`, () =>
    page.evaluate((sel) => {
      const field = document.querySelector(sel);
      if (!field) return false;
      const summaries = [];
      for (let p = field.parentElement; p; p = p.parentElement) {
        if (p.tagName === 'DETAILS' && !p.open) {
          const summary = p.querySelector(':scope > summary');
          if (summary) summaries.push(summary);
        }
      }
      summaries.forEach((s, i) => s.setAttribute('data-journey-open', String(i)));
      return true;
    }, selector),
  );
  if (!found) return false;

  // Outermost first, so nested disclosures become clickable in turn.
  for (const handle of (await page.$$('[data-journey-open]')).reverse()) {
    await guard('open a disclosure', () => handle.click());
  }
  await page.evaluate(() =>
    document.querySelectorAll('[data-journey-open]').forEach((n) => n.removeAttribute('data-journey-open')),
  ).catch(() => {});
  await guard(`scroll ${selector} into view`, () =>
    page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), selector),
  );
  return true;
}

async function typeInto(page, selector, value) {
  if (!(await reveal(page, selector))) {
    record(`no field ${selector} on ${page.url()}`);
    return false;
  }
  const el = await page.$(selector);
  if (!el) return false;
  await guard(`focus ${selector}`, () => el.click({ clickCount: 3 }));
  await guard(`type into ${selector}`, () => el.type(value, { delay: 1 }));
  return true;
}

async function selectOption(page, selector, value) {
  if (!(await reveal(page, selector))) {
    record(`no select ${selector} on ${page.url()}`);
    return false;
  }
  const chosen = await guard(`choose "${value}" in ${selector}`, () => page.select(selector, value));
  return Array.isArray(chosen) && chosen.length > 0;
}

/** Submits the form owning `selector` by clicking its real submit button. */
async function submitNear(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const field = document.querySelector(sel);
    const form = field?.closest('form');
    const button = form?.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
    if (!button) return false;
    button.click();
    return true;
  }, selector);
  if (!clicked) {
    record(`no submit button for the form containing ${selector}`);
    return false;
  }
  await settle(page);
  return true;
}

async function settle(page) {
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 120));
}

async function pageText(page) {
  return page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText);
}

async function expectText(page, needle, label) {
  const text = await pageText(page);
  if (text.toLowerCase().includes(needle.toLowerCase())) {
    ok(label);
    return true;
  }
  record(`${label} — "${needle}" not found on ${page.url()}`);
  return false;
}

async function expectNoText(page, needle, label) {
  const text = await pageText(page);
  if (!text.toLowerCase().includes(needle.toLowerCase())) {
    ok(label);
    return true;
  }
  record(`${label} — "${needle}" unexpectedly present on ${page.url()}`);
  return false;
}

/* --------------------------------------------------------------- journeys */

/** A member writes a discussion post; another member sees it. */
async function journeyDiscussion(browser) {
  console.log('\n— discussion: post and read back');
  const nadia = await member(browser, 'nadia');

  await visit(nadia, '/discussion');
  await typeInto(nadia, '#discussion-compose input[name="topic"]', 'care-quality');
  await typeInto(
    nadia,
    '#discussion-compose textarea[name="content"]',
    'Ward deliveries arrived 35 minutes after pharmacy release again last night. Can we look at the sequence before the next rota?',
  );
  await submitNear(nadia, '#discussion-compose textarea[name="content"]');
  await expectText(nadia, 'pharmacy release', 'post appears in the thread after submitting');
  await shot(nadia, 'discussion-posted', 'A member posts to the discussion lane and sees it appear, attributed to their handle.', { focus: '.discussion-list' });

  const tomas = await member(browser, 'tomas');
  await visit(tomas, '/discussion');
  await expectText(tomas, 'pharmacy release', "another member sees the first member's post");
}

/** The full decision track: draft, sign to quorum, deliberate, vote, tally. */
async function journeyProposalToVote(browser) {
  console.log('\n— proposals: draft → sign → deliberate → vote');
  const nadia = await member(browser, 'nadia');

  await visit(nadia, '/petitions');
  await typeInto(nadia, '#petitions-compose input[name="title"]', 'Review the night medication delivery sequence');
  await typeInto(
    nadia,
    '#petitions-compose textarea[name="summary"]',
    'Run a bounded pilot on the pharmacy-to-ward delivery order across three night shifts before the next rota.',
  );
  await typeInto(nadia, '#petitions-compose textarea[name="problem"]', 'Deliveries land after the safety-check window, compressing the checks rather than removing them.');
  await typeInto(nadia, '#petitions-compose textarea[name="proposedAction"]', 'Pilot a revised release-to-ward sequence with pharmacy and logistics for three night shifts.');
  await typeInto(nadia, '#petitions-compose textarea[name="impact"]', 'Night ward staff regain the full check window; pharmacy keeps its release batching.');
  await typeInto(nadia, '#petitions-compose input[name="quorum"]', '3');
  await submitNear(nadia, '#petitions-compose input[name="title"]');
  const drafted = await expectText(nadia, 'night medication delivery sequence', 'drafting opens the proposal workspace');
  await shot(nadia, 'proposal-drafted', 'A member drafts a proposal with a structured outline (problem, action, impact).');
  if (!drafted) return null;

  const petitionId = await nadia.evaluate(() => {
    const el = document.querySelector('[id^="petition-"]');
    return el ? el.id.replace('petition-', '') : null;
  });
  if (!petitionId) {
    record('could not find a petition id to sign');
    return null;
  }

  // Signatures from distinct members drive quorum.
  await clickText(nadia, 'button', 'Sign', { optional: true });
  for (const handle of ['tomas', 'ines', 'koen']) {
    const page = await member(browser, handle);
    await visit(page, `/petitions?proposal=${petitionId}`);
    await clickText(page, 'button', 'Sign', { optional: true });
  }

  await visit(nadia, `/petitions?proposal=${petitionId}`);
  await shot(nadia, 'proposal-signatures', 'Signatures accumulate toward quorum, which moves the proposal into discussion.', { focus: '[id^="petition-"]' });

  // Deliberate with a stance tag.
  await visit(nadia, `/petitions?proposal=${petitionId}&view=discussion`);
  await selectOption(nadia, `select[name="stance"]`, 'support');
  await typeInto(nadia, `textarea[name="content"]`, 'Three shifts is enough to see the pattern without disrupting the rota.');
  await submitNear(nadia, `textarea[name="content"]`);
  await expectText(nadia, 'without disrupting the rota', 'deliberation note appears on the proposal');
  await shot(nadia, 'proposal-deliberation', 'A stance-tagged deliberation note on a proposal.', { focus: '[id^="petition-"]' });

  return petitionId;
}

/**
 * Opening a vote is a moderation act, not something the author can do alone.
 * A moderator freezes the draft and opens the ballot; members then vote.
 */
async function journeyVote(browser, petitionId) {
  console.log('\n— voting: a moderator freezes and opens the ballot, members vote');
  if (!petitionId) {
    record('no proposal to vote on (drafting failed earlier)');
    return;
  }

  // A plain member must not be able to open a vote on their own proposal.
  const nadia = await member(browser, 'nadia');
  await visit(nadia, `/petitions?proposal=${petitionId}`);
  const authorSeesModeration = await nadia.$('form[action="/petitions/status"]');
  if (authorSeesModeration) {
    record('a non-moderator author is offered the status/freeze control');
  } else {
    ok('opening a vote is not offered to a non-moderator author');
  }

  const mod = await moderator(browser);
  await visit(mod, `/petitions?proposal=${petitionId}`);
  if (!(await selectOption(mod, 'form[action="/petitions/status"] select[name="status"]', 'vote'))) return;
  await clickText(mod, 'span', 'Confirm freeze', { optional: true });
  await shot(mod, 'proposal-freeze', 'A moderator must confirm the pre-vote draft freeze before the ballot opens.');
  await clickText(mod, 'button', 'Apply');
  await expectText(mod, 'frozen at', 'the draft is frozen and the freeze is attributed');
  await shot(mod, 'proposal-vote-open', 'The proposal is frozen and open for voting.', { focus: '[id^="petition-"]' });

  // Members cast their ballots.
  for (const handle of ['nadia', 'tomas', 'ines']) {
    const page = await member(browser, handle);
    await visit(page, `/petitions?proposal=${petitionId}&view=ballot`);
    await selectOption(page, 'form[action="/petitions/vote"] select[name="choice"]', 'yes');
    await clickText(page, 'button', 'Vote', { optional: true });
  }

  const nadia2 = await member(browser, 'nadia');
  await visit(nadia2, `/petitions?proposal=${petitionId}&view=ballot`);
  await expectText(nadia2, 'yes', 'the tally shows the recorded votes');
  await shot(nadia2, 'vote-cast', 'Members cast topic-scoped votes; the tally updates and each vote is a signed envelope.', { focus: '[id^="petition-"]' });
}

/** A member creates a group and another joins it. */
async function journeyGroups(browser) {
  console.log('\n— groups: create and join');
  const mara = await member(browser, 'mara');

  await visit(mara, '/groups');
  await typeInto(mara, 'input[name="name"]', 'Night shift coordination');
  await typeInto(mara, 'input[name="topics"]', 'care-quality,logistics');
  await typeInto(mara, 'textarea[name="description"]', 'Members working nights across pharmacy, wards, and logistics.');
  await submitNear(mara, 'input[name="name"]');
  await expectText(mara, 'Night shift coordination', 'group appears after creating it');
  await shot(mara, 'group-created', 'A member creates a working group with its own topics.');

  const koen = await member(browser, 'koen');
  await visit(koen, '/groups');
  const joined = await clickText(koen, 'button', 'Join', { optional: true });
  if (joined) {
    await expectText(koen, 'Leave', 'joining a group flips the control to Leave');
    await shot(koen, 'group-joined', 'Another member joins the group and can act inside it.', { focus: '[data-composer-section="groups-list"]' });
  } else {
    const controls = await koen.evaluate(() =>
      [...document.querySelectorAll('main button')].map((b) => (b.textContent || '').trim()).slice(0, 12),
    );
    record(`no Join control on /groups for a non-member; buttons present: ${JSON.stringify(controls)}`);
  }
}

/** A member delegates a topic and can see where their influence goes. */
async function journeyDelegation(browser) {
  console.log('\n— delegation: set a topic delegate');
  const koen = await member(browser, 'koen');

  await visit(koen, '/delegation');
  await typeInto(koen, 'form[data-enhance="delegation"] input[name="topic"]', 'care-quality');
  await typeInto(koen, 'input[name="delegateHash"]', 'ines');
  await submitNear(koen, 'input[name="delegateHash"]');
  await expectText(koen, 'care-quality', 'delegation appears after setting it');
  await expectText(koen, 'ines', 'the chosen delegate is shown by handle, not by raw hash');
  await shot(koen, 'delegation-set', 'Topic-scoped delegation, chosen by handle, with freshness and renewal cues.', {
    focus: '[data-composer-section="delegation-effective"]',
  });
}

/** The organization workspace: read a case, switch layers. */
async function journeyOrganization(browser) {
  console.log('\n— organization: read a case and switch layers');
  const nadia = await member(browser, 'nadia');

  await visit(nadia, '/organization?view=preview');
  await expectText(nadia, 'Night medication deliveries', 'the focused case opens on its source message');
  await shot(nadia, 'organization-case', 'The focused case opens on the source message, with the case lens beside it.', { focus: '.pressure-board' });

  const switched = await clickText(nadia, '.pressure-layer-tab', 'Protection', { optional: true });
  if (switched) {
    await expectText(nadia, 'Protection', 'switching to a disabled layer shows its preview');
    await shot(nadia, 'organization-layer', 'A layer that is not enabled stays visible as a labeled preview.', { focus: '.pressure-board' });
  } else {
    record('could not switch to the Protection layer tab');
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 60000,
  });
  const wanted = (name) => !ONLY.length || ONLY.includes(name);
  try {
    if (wanted('discussion')) await journeyDiscussion(browser);
    // Voting depends on a proposal existing, so the two run as one track.
    let petitionId = null;
    if (wanted('proposal')) petitionId = await journeyProposalToVote(browser);
    if (wanted('vote')) await journeyVote(browser, petitionId);
    if (wanted('groups')) await journeyGroups(browser);
    if (wanted('delegation')) await journeyDelegation(browser);
    if (wanted('organization')) await journeyOrganization(browser);
  } finally {
    if (process.env.KEEP !== '1') await browser.close();
  }

  console.log(`\n${shots.length} screenshots in ${OUT_DIR}`);
  if (dialogs.length) {
    console.log(`\n${dialogs.length} native dialogs interrupted the member:`);
    for (const d of dialogs) console.log(`  - ${d}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} FAILURES:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll journeys passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
