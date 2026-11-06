#!/usr/bin/env node
/**
 * party-journeys — Scenario A: Rete Civica Nazionale
 * --------------------------------------------------
 * Drives the *representative party* half of the framework through the UI the way a
 * member actually uses it: deliberation before any vote, a long-form argument about
 * the free mandate, a proposal that earns its way to a ballot and is visibly changed
 * by its own deliberation, an attributed freeze, a tally that shows the dissent, a
 * readable delegation chain, a ranked election won on transfers, a constitution that
 * members can propose to change, and an accountability trail nobody can quietly
 * rewrite.
 *
 * The in-app copy is English; the party, its people and its legal order stay Italian
 * (names, handles, laws, institutions), as principle-docs/SimulationScenarios.md
 * specifies. Every screenshot this writes is a README capture.
 *
 * It is the companion to user-journeys.js (the organization-operations regression
 * driver). Reference: principle-docs/SimulationScenarios.md (Scenario A) and
 * principle-docs/RepresentativeParties.md.
 *
 *   ENFORCE_CIRCLE=true CIRCLE_POLICY_ID=rete-civica-nazionale \
 *     DATA_VALIDATION_LEVEL=strict DATA_PREVIEW=false ./run-standalone.sh   # terminal 1
 *   BASE_URL=http://127.0.0.1:3000 OUT_DIR=md-assets/party \
 *     node scripts/party-journeys.js                                       # terminal 2
 *
 * Options (env):
 *   BASE_URL   deployment to drive (default http://127.0.0.1:3000)
 *   OUT_DIR    screenshot output directory (default .local/party)
 *   ONLY       comma-separated journey names to run
 *   HEADLESS   "false" to watch it run in a real window
 *   KEEP       "1" to leave the browser open on failure
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import puppeteer from 'puppeteer';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || '.local/party';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const HEADLESS = process.env.HEADLESS === 'false' ? false : 'new';

const failures = [];
const shots = [];
const dialogs = [];
/** circle_session cookie -> handle, so a shared session is caught immediately. */
const sessionIds = new Map();
/** handle -> circle_session cookie value, so the provider admin can set a role. */
const sessionByHandle = new Map();

/**
 * The cast. Roles that are not the default are assigned by the provider admin in
 * `journeyArrive`, exactly as A1.5 records: role assignment is a provider act.
 */
const CAST = [
  { handle: 'giulia.ferrero' }, // nurse, Torino — raises the waiting-list case
  { handle: 'marco.deluca', role: 'delegate' }, // health economist — the super-delegate
  { handle: 'sofia.bianchi', role: 'delegate' }, // constitutional lawyer
  { handle: 'ahmed.ben.salah' }, // warehouse worker — minimum wage, from the floor
  { handle: 'luca.esposito' }, // restaurant owner — the reasonable dissent, votes no
  { handle: 'anna.conti' }, // student — ius scholae, social lane
  { handle: 'valentina.sanna' }, // researcher — fact-checks
  { handle: 'nadia.hamdi' }, // GP, Palermo — the same failure from the territory
  { handle: 'tommaso.ricci' }, // developer, Trento — concedes a point in public
  { handle: 'davide.villa' }, // farmer — the long tail; delegates almost everything
  { handle: 'paolo.greco' }, // retired teacher — head of the delegation chain
  { handle: 'irene.fabbri', role: 'delegate' }, // councillor — runs the group election
  { handle: 'elena.rossi', role: 'moderator' }, // party secretary — her freezes are attributed
];

/* ---------------------------------------------------------------- helpers */

async function signIn(page) {
  await visit(page, '/auth/eudi');
  const followed = await clickText(page, 'a', 'simulate callback');
  if (!followed) record('no wallet callback link on /auth/eudi');
  await settle(page);
}

async function newMember(browser, { handle }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => record(`pageerror on ${page.url()}: ${err.message}`));
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
  const cookie = (await page.cookies()).find((c) => c.name === 'circle_session')?.value;
  if (cookie && sessionIds.has(cookie)) {
    record(`@${handle} is reusing the session of @${sessionIds.get(cookie)} — members are not isolated`);
  }
  if (cookie) {
    sessionIds.set(cookie, handle);
    sessionByHandle.set(handle, cookie);
  }
  return page;
}

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

/**
 * Navigates, then settles separately. Waiting on `networkidle0` inside goto() times out
 * intermittently with nothing in flight (Chrome drops the lifecycle event in one of many
 * contexts), which aborted whole runs; `load` plus a bounded idle wait is equivalent here.
 */
async function visit(page, url) {
  await page.bringToFront();
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'load' });
  await page.waitForNetworkIdle({ idleTime: 250, timeout: 5000 }).catch(() => {});
}

/** The provider operator. Verifies the seeded pending admin session by following its login link. */
async function providerAdmin(browser) {
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
  // Clear first: a triple-click does not select a prefilled number input, and a revision
  // form arrives prefilled with the current text, so typing would append to it.
  await guard(`focus ${selector}`, () => el.click({ clickCount: 3 }));
  await el.evaluate((node) => { node.value = ''; }).catch(() => {});
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

/**
 * Selects the option whose visible label contains `labelText`. Election ballots
 * render candidates as @handle while the option value stays a blinded hash, so a
 * member picks a name, never a hash — and so must this driver.
 */
async function selectOptionByLabel(page, selector, labelText) {
  if (!(await reveal(page, selector))) {
    record(`no select ${selector} on ${page.url()}`);
    return false;
  }
  const chosen = await guard(`choose label "${labelText}" in ${selector}`, () =>
    page.evaluate(
      (sel, want) => {
        const select = document.querySelector(sel);
        if (!select) return false;
        const option = [...select.options].find((o) => (o.textContent || '').toLowerCase().includes(want.toLowerCase()));
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      selector,
      labelText,
    ),
  );
  if (!chosen) record(`no option matching "${labelText}" in ${selector} on ${page.url()}`);
  return Boolean(chosen);
}

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

/** Posts one attributed discussion note in a topic, with an optional stance and evidence. */
async function post(page, { topic, stance, content, evidence }) {
  await visit(page, '/discussion');
  await typeInto(page, '#discussion-compose input[name="topic"]', topic);
  if (stance) await selectOption(page, '#discussion-compose select[name="stance"]', stance);
  await typeInto(page, '#discussion-compose textarea[name="content"]', content);
  if (evidence) await typeInto(page, '#discussion-compose textarea[name="evidenceLinks"]', evidence);
  await submitNear(page, '#discussion-compose textarea[name="content"]');
}

/** Posts one short update to the social lane (A2.7 — the lane stays conversational). */
async function socialPost(page, { content, visibility, targetHandle }) {
  await visit(page, '/social/feed');
  if (!(await typeInto(page, '#social-compose textarea[name="content"]', content))) return false;
  if (visibility) await selectOption(page, '#social-compose select[name="visibility"]', visibility);
  if (targetHandle) await typeInto(page, '#social-compose input[name="targetHandle"]', targetHandle);
  return submitNear(page, '#social-compose textarea[name="content"]');
}

/** Adds one typed follow edge (circle/interest/info/alerts). */
async function follow(page, { handle, type }) {
  await visit(page, '/social/feed');
  if (!(await typeInto(page, '#social-follows input[name="handle"]', handle))) return false;
  if (type) await typeInto(page, '#social-follows input[name="type"]', type);
  return submitNear(page, '#social-follows input[name="handle"]');
}

/** Finds the id of the proposal whose card contains `titleFragment`. */
async function findPetitionId(page, titleFragment) {
  return page.evaluate((frag) => {
    const cards = [...document.querySelectorAll('[id^="petition-"]')];
    const hit = cards.find((c) => (c.textContent || '').toLowerCase().includes(frag.toLowerCase()));
    return hit ? hit.id.replace('petition-', '') : null;
  }, titleFragment);
}

function openProposal(page, id, view = 'overview') {
  const query = new URLSearchParams({ proposal: id, view });
  return visit(page, `/petitions?${query}`);
}

/** Finds a proposal from the collection and signs it in its workspace. */
async function signPetition(page, titleFragment) {
  await visit(page, '/petitions');
  const id = await findPetitionId(page, titleFragment);
  if (!id) {
    record(`Could not find the proposal containing "${titleFragment}".`);
    return false;
  }
  await openProposal(page, id);
  return submitNear(page, '#proposal-sign input[name="petitionId"]');
}

/** Opens the <details> whose summary text matches, so a collapsed card section is visible in a shot. */
async function openDetails(page, summaryText, { scope = '' } = {}) {
  const opened = await page.evaluate((want, scopeSel) => {
    const root = scopeSel ? document.querySelector(scopeSel) : document;
    if (!root) return false;
    const details = [...root.querySelectorAll('details')];
    const hit = details.find((d) => (d.querySelector('summary')?.textContent || '').toLowerCase().includes(want.toLowerCase()));
    if (!hit) return false;
    hit.open = true;
    hit.scrollIntoView({ block: 'center' });
    return true;
  }, summaryText, scope);
  await settle(page);
  return opened;
}

/** Types into the first field matching `selector` inside the card that contains `text`. */
async function typeInCard(page, cardSelector, text, fieldSelector, value) {
  const marked = await page.evaluate(
    (cardSel, want, fieldSel) => {
      const cards = [...document.querySelectorAll(cardSel)];
      const card = cards.find((c) => (c.textContent || '').toLowerCase().includes(want.toLowerCase()));
      const field = card?.querySelector(fieldSel);
      if (!field) return false;
      field.setAttribute('data-journey-field', '1');
      return true;
    },
    cardSelector,
    text,
    fieldSelector,
  );
  if (!marked) {
    record(`no ${fieldSelector} in the ${cardSelector} containing "${text}" on ${page.url()}`);
    return false;
  }
  const typed = await typeInto(page, '[data-journey-field]', value);
  await page.evaluate(() => document.querySelector('[data-journey-field]')?.removeAttribute('data-journey-field')).catch(() => {});
  return typed;
}

/* --------------------------------------------------------------- journeys */

/**
 * One category hierarchy for the whole party (SimulationScenarios.md, A.2). The debates are
 * Italian ones; their labels are English so the captures read for an English-language
 * reviewer. Every discussion, proposal, group, election and delegation below files into
 * this tree, so a delegation on a parent category visibly reaches its subcategories and the
 * group directory has one row per subject rather than a flat id beside a path.
 */
const TOPIC = {
  waitingLists: 'Healthcare / Waiting lists',
  primaryCare: 'Healthcare / Primary care',
  minimumWage: 'Labour / Minimum wage',
  autonomy: 'Institutions / Differentiated autonomy',
  freeMandate: 'Institutions / Free mandate',
  iusScholae: 'Citizenship / Ius scholae',
  landUse: 'Environment / Land consumption',
};
const CATEGORY = {
  health: 'Healthcare',
  labour: 'Labour',
  waitingLists: TOPIC.waitingLists,
};
const EVIDENCE = {
  survey: 'https://example.rcn.it/waiting-lists/survey-2026',
  method: 'https://example.rcn.it/waiting-lists/survey-method',
};
const CIRCLE_NAME = 'Public Healthcare Circle';
const BRANCH_NAME = 'Waiting Lists Workshop';

/** A1 — Members arrive, claim handles, and are given their (visible) roles by the provider. */
async function journeyArrive(browser) {
  console.log('\n— arrive: verify, claim handles, assign roles');
  for (const { handle } of CAST) {
    await member(browser, handle);
  }
  ok(`${CAST.length} members verified and named`);

  const admin = await providerAdmin(browser);
  for (const { handle, role } of CAST) {
    if (!role) continue;
    const sessionId = sessionByHandle.get(handle);
    if (!sessionId) {
      record(`no session id captured for @${handle}; cannot assign ${role}`);
      continue;
    }
    await visit(admin, '/admin');
    await typeInto(admin, 'input[name="sessionId"]', sessionId);
    await selectOption(admin, 'select[name="sessionRole"]', role);
    await submitNear(admin, 'input[name="sessionId"]');
    await expectText(admin, role, `@${handle} assigned ${role} (a provider act, and visible)`);
  }

  // A.0 — the party's constitution defaults. The vote method stays `majority`: ballots
  // are yes/no/abstain today, and publishing "condorcet" would claim a count that does
  // not happen (multi-method ballots are Phase 3).
  await visit(admin, '/admin');
  const configured = await admin.evaluate(() => {
    const form = [...document.querySelectorAll('form[action="/admin"]')].find((f) =>
      f.querySelector('input[name="intent"][value="governance"]'),
    );
    if (!form) return false;
    const set = (name, value) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) field.value = value;
    };
    set('governanceQuorumDefault', '250');
    set('governanceVoteMethod', 'majority');
    set('governanceDiscussionWindowDays', '14');
    set('governanceVoteWindowDays', '7');
    set('governanceDelegationDecayDays', '180');
    set('governanceDelegateVoteWindowDays', '5');
    form.querySelector('button[type="submit"], button:not([type])')?.click();
    return true;
  });
  if (!configured) record('the provider has no governance-defaults form in /admin');

  // A1.3 — delegates publish a bio. The field is provider-local (it never gossips), so the
  // provider declares it in the structure manager before anyone can fill it.
  await visit(admin, '/admin');
  await typeInto(admin, 'textarea[name="providerFields"]', 'publicBio:string:Public bio (shown on your delegate profile)');
  await submitNear(admin, 'textarea[name="providerFields"]');
  const bios = [
    ['marco.deluca', 'Health economist, Bologna. I work on CUP data and the economics of waiting lists; I publish my models before I vote on them.'],
    ['sofia.bianchi', 'Constitutional lawyer, Rome. Delegate on institutional questions only — Title V, autonomy, the free mandate.'],
    ['irene.fabbri', 'Municipal councillor, Florence. I run the Public Healthcare Circle and report back after every council vote.'],
  ];
  for (const [handle, bio] of bios) {
    const page = await member(browser, handle);
    await visit(page, '/profile');
    if (await typeInto(page, 'input[name="profile_publicbio" i]', bio)) {
      await page_check(page, 'input[name="profileConsent"]');
      await submitNear(page, 'input[name="profile_publicbio" i]');
    }
  }
  await settle(admin);
  await visit(admin, '/governance');
  await expectText(admin, '250 signatures', 'the party constitution publishes its Scenario A defaults');
}

/** A2 — Conversation before any vote: live threads, a fact-check loop, a public concession. */
async function journeyDiscussion(browser) {
  console.log('\n— discussion: deliberation before any vote');

  // A2.1/A2.2/A2.6/A2.11/A2.12 — the waiting-list thread: lived experience,
  // corroborated by data, questioned, and answered with a method.
  const giulia = await member(browser, 'giulia.ferrero');
  await post(giulia, {
    topic: TOPIC.waitingLists,
    stance: 'concern',
    content:
      'In my department, the first available non-urgent cardiology appointment is 14 months away. Patients who can afford it use intramoenia and are seen within two weeks. Same building, same doctors, same day.',
    evidence: EVIDENCE.survey,
  });
  await expectText(giulia, '14 months', 'a concrete, attributed claim opens the thread');

  const marco = await member(browser, 'marco.deluca');
  await post(marco, {
    topic: TOPIC.waitingLists,
    stance: 'support',
    content:
      'The CUP data I aggregated across three regions confirm it: for priority classes D and P, exceeding PNGLA waiting times is the rule, not the exception. And where the public service runs late, intramoenia in the same specialty runs on time. This is not a local anomaly; it is an economic equilibrium.',
  });

  const valentina = await member(browser, 'valentina.sanna');
  await post(valentina, {
    topic: TOPIC.waitingLists,
    stance: 'neutral',
    content:
      'Is the 14-month figure a median or a worst case? That changes everything: a median describes the system, while a worst case describes a queue. Before we build a proposal on it, we need the distribution, not an anecdote.',
  });

  const nadia = await member(browser, 'nadia.hamdi');
  await post(nadia, {
    topic: TOPIC.waitingLists,
    stance: 'concern',
    content:
      'From general practice: I prescribe priority class B, which means 10 days under the PNGLA. The CUP offers me 96 days, or the paid pathway in the same building. The priority class has become a statement of intent.',
  });

  await post(giulia, {
    topic: TOPIC.waitingLists,
    stance: 'neutral',
    content:
      '@valentina.sanna Median, not worst case: an internal survey of 14 health authorities, March 2026, with the method attached. The worst cases are far beyond that.',
    evidence: EVIDENCE.method,
  });

  await visit(giulia, '/discussion?topic=Healthcare');
  await expectText(giulia, TOPIC.waitingLists, 'the waiting-list thread carries five attributed notes');
  await shot(giulia, 'party-discussion', 'Deliberation before any vote: lived experience, corroborated by data and checked — each note stance-tagged and attributed to a verified person.', {
    focus: '.page-grid--discussion .page-main',
  });
  await visit(giulia, '/discussion?topic=Healthcare&q=survey-method');
  await clickText(giulia, '#discussion-feed .contribution-link', TOPIC.waitingLists);
  await expectText(giulia, 'Median, not worst case', 'search opens the contribution with the survey method');
  if (new URL(giulia.url()).searchParams.has('post')) ok('the evidence note has its own address');
  else record('the evidence note did not open independently of the feed');
  await clickText(giulia, 'main a', 'Back to Discussion');
  if (new URL(giulia.url()).searchParams.get('q') === 'survey-method') ok('returning keeps the evidence search');
  else record('returning from the evidence note dropped the evidence search');

  // A2.3/A2.4/A2.9/A2.10 — the minimum-wage thread: the dissent has to be reasonable,
  // and evidence reframes what any proposal will have to answer.
  const luca = await member(browser, 'luca.esposito');
  await post(luca, {
    topic: TOPIC.minimumWage,
    stance: 'concern',
    content:
      "Nine euros gross per hour for a restaurant with four seasonal employees means either raising prices by 12% or closing in November. I am not against a minimum wage; I am against doing it without looking at hospitality's real margins.",
  });
  const ahmed = await member(browser, 'ahmed.ben.salah');
  await post(ahmed, {
    topic: TOPIC.minimumWage,
    stance: 'support',
    content:
      'At my warehouse, the pirate contract pays €6.40 an hour. That is not competition on margins; it is competition over who will accept less. The minimum wage does not close honest businesses; it closes the ones that survive like this.',
  });
  await post(valentina, {
    topic: TOPIC.minimumWage,
    stance: 'neutral',
    content:
      'CNEL figures, 2023 review: more than 900 CCNL agreements are filed, but the 20 most used cover the vast majority of employees. The problem is not the number of contracts; it is renewals expired for years and pay scales below €7 in security, multiservices, and parts of the tertiary sector. Any proposal must say what it does about THIS.',
  });
  await post(marco, {
    topic: TOPIC.minimumWage,
    stance: 'neutral',
    content:
      'EU context: Directive 2022/2041 does not require a statutory minimum where collective-agreement coverage is high. The real question is whether our EFFECTIVE coverage — weighted for expired renewals — meets that standard. If it does not, a statutory minimum is not ideology; it is compliance.',
  });

  // A2.5 — the split that isn't left-right: a member concedes a point in public.
  const tommaso = await member(browser, 'tommaso.ricci');
  await post(tommaso, {
    topic: TOPIC.autonomy,
    stance: 'support',
    content:
      'Healthcare administration in the special-autonomy and benchmark regions shows that local fiscal responsibility can work. The problem is not autonomy; it is doing it without LEP.',
  });
  await post(nadia, {
    topic: TOPIC.autonomy,
    stance: 'concern',
    content:
      'Without funded LEP, autonomy locks in historic spending: those who have always had less continue to have less, only this time by contract. The Constitutional Court said this clearly in judgment 192/2024 — it is not a technical detail.',
  });
  await post(tommaso, {
    topic: TOPIC.autonomy,
    stance: 'neutral',
    content:
      'You are right about LEP, and I admit it: without funding, my position does not stand up. But that means the fight is for LEP, not against autonomy itself.',
  });
  await visit(tommaso, '/discussion');
  await expectText(tommaso, 'I admit it', 'the concession is on the record, in the same thread');
  await shot(tommaso, 'party-discussion-concession', 'The split that is not left-right: a member concedes a point in public and the thread survives it.', {
    focus: '.discussion-list',
  });

  // A2.16 — the topic that resists delegation: values, not parameters.
  const anna = await member(browser, 'anna.conti');
  await post(anna, {
    topic: TOPIC.iusScholae,
    stance: 'proposal',
    content:
      'The June 2025 referendum on reducing the residency requirement from 10 to 5 years missed quorum with about 30% turnout — but about 65% of those who voted said yes. And ius scholae was not even on the ballot: under Law 91/1992, five years of schooling in Italy count for nothing. I propose that we take this to the assembly.',
  });

  // A2.17 — the long tail: one member, one post, a real stake.
  const davide = await member(browser, 'davide.villa');
  await post(davide, {
    topic: TOPIC.landUse,
    stance: 'concern',
    content:
      'ISPRA reports about 20 hectares of land consumed per day, 2.3 square metres per second. The national law has been stalled for more than ten years. Meanwhile, my municipality is sealing yet another agricultural area for logistics. Does anyone besides me work on this?',
  });
}

/**
 * A2.8 — the long-form lane. The constitutional lawyer writes the argument the whole
 * platform rests on (the free mandate, art. 67 Cost.), a member pushes back on it, and
 * she answers — the forum is where a party argues with itself at length.
 */
async function journeyForum(browser) {
  console.log('\n— forum: the free-mandate argument, and a member pushing back');
  const title = 'Why software cannot engineer around the free-mandate rule';
  const sofia = await member(browser, 'sofia.bianchi');
  await visit(sofia, '/forum');
  await typeInto(sofia, '#forum-compose input[name="title"]', title);
  await typeInto(sofia, '#forum-compose input[name="topic"]', TOPIC.freeMandate);
  await typeInto(
    sofia,
    '#forum-compose textarea[name="content"]',
    'Article 67 of the Constitution says every member of Parliament represents the Nation and serves without a binding mandate. No platform can change that, and none should try. We have already watched a party try to bind its elected members through online votes and contractual penalties: it produced expulsions and litigation, not accountability. What software can do is make the record impossible to rewrite — who proposed what, how the text changed, how the members voted, and how the representative voted afterwards. A representative who diverges keeps the seat and owes an explanation. That is soft power, and it is the only constitutional path open to us.',
  );
  await submitNear(sofia, '#forum-compose input[name="title"]');
  if (!(await expectText(sofia, title, 'the article is published under a verified byline'))) return;
  const articlePath = new URL(sofia.url()).pathname + new URL(sofia.url()).search;

  const tommaso = await member(browser, 'tommaso.ricci');
  await visit(tommaso, '/forum');
  await typeInto(tommaso, '#forum-threads input[name="q"]', 'free mandate');
  await submitNear(tommaso, '#forum-threads input[name="q"]');
  if (!(await clickText(tommaso, '#forum-threads h3 a', title))) return;
  const replyField = '#forum-reply textarea[name="content"]';
  if (await typeInto(tommaso, replyField,
    'How is the ethical pact different from a party whip? If diverging costs you re-selection, is that not a mandate by other means?')) {
    await submitNear(tommaso, replyField);
  }

  await visit(sofia, articlePath);
  if (await typeInto(sofia, replyField,
    'The difference is who can compel. A whip can throw you out of the group mid-term; the pact can only publish your vote next to ours and ask for your reasons. The seat stays yours either way — the members decide at re-selection, in the open.')) {
    await submitNear(sofia, replyField);
  }

  await tommaso.reload();
  await expectText(tommaso, 'mandate by other means', 'the member’s objection sits under the article');
  await expectText(tommaso, 'who can compel', 'the author answers in the same thread');
  await shot(tommaso, 'party-forum', 'The long-form lane: the constitutional lawyer’s case for the free mandate (art. 67 Cost.), a member asking whether the ethical pact is a whip by another name, and the answer — argued in the open, attributed on both sides.', {
    focus: '.forum-reading',
  });
  await clickText(tommaso, '.forum-reading > a', 'Back to Forum articles');
  const search = await tommaso.$eval('#forum-threads input[name="q"]', (input) => input.value);
  if (search !== 'free mandate') record('The forum return link lost the active search.');
}

/** A3 — A proposal earns its way to a vote: outline, revision, quorum, argument map, a revised text. */
async function journeyProposal(browser) {
  console.log('\n— proposal: draft → revise → sign to quorum → deliberate → revise again');
  const giulia = await member(browser, 'giulia.ferrero');
  const title = 'Conditional intramoenia: an ALPI cap wherever PNGLA windows are missed';

  await visit(giulia, '/petitions');
  await typeInto(giulia, '#petitions-compose input[name="title"]', title);
  await typeInto(giulia, '#petitions-compose input[name="topic"]', CATEGORY.waitingLists);
  await typeInto(giulia, '#petitions-compose input[name="quorum"]', '6');
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="summary"]',
    'In specialties where public-service waiting times exceed PNGLA priority classes, intramoenia activity in the same specialty falls to 15% of public-service volumes until those times return to compliance.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="problem"]',
    'Law 120/2007 already prohibits ALPI from exceeding public-service volumes, but the constraint is aggregated and weakly checked. The result: the same facility delivers in two weeks, for payment, what it delivers free of charge in fourteen months. This is not a waiting list; it is a pricing mechanism.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="proposedAction"]',
    "A 15% cap per specialty, tied to the national platform's monitoring (Law 107/2024), with automatic suspension once waiting times return to the U/B/D/P priority classes.",
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="impact"]',
    'Patients without the means to pay regain access within statutory time limits; the existing constraint becomes verifiable by specialty.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="risks"]',
    'Specialists may leave for the fully private sector; the cap must be paired with incentives for public-service activity, not sanctions alone.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="implementationPlan"]',
    'Measure at three months on the national platform; trial the cap in two pilot health authorities at six months; review at twelve.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="evidenceSummary"]',
    'RCN survey of 14 health authorities (March 2026); review of AGENAS monitoring; legal framework: Laws 120/2007 and 107/2024.',
  );
  await typeInto(giulia, '#petitions-compose textarea[name="evidenceLinks"]', EVIDENCE.survey);
  await submitNear(giulia, '#petitions-compose input[name="title"]');
  const drafted = await expectText(giulia, 'Conditional intramoenia', 'drafting opens the proposal workspace');
  if (!drafted) return null;

  const petitionId = await findPetitionId(giulia, 'Conditional intramoenia');
  if (!petitionId) {
    record('could not find the intramoenia proposal id');
    return null;
  }
  await openDetails(giulia, 'Structured outline', { scope: `#petition-${petitionId}` });
  await shot(giulia, 'party-proposal', 'A proposal earns its way to a vote: the structured outline (problem, action, impact, risks, plan) forces the argument to be made, not asserted.', {
    focus: `#petition-${petitionId}`,
  });

  // A3.2 — the economist revises the cap; the change and its author go on the record.
  const marco = await member(browser, 'marco.deluca');
  await openProposal(marco, petitionId);
  await typeInto(marco, `#petition-${petitionId} form[action="/petitions/update"] textarea[name="summary"]`,
    'In specialties where public-service waiting times exceed PNGLA priority classes, intramoenia activity in the same specialty falls to 20% of public-service volumes until those times return to compliance.');
  await typeInto(marco, `#petition-${petitionId} form[action="/petitions/update"] textarea[name="proposedAction"]`,
    "A 20% cap per specialty, tied to the national platform's monitoring (Law 107/2024), with automatic suspension once waiting times return to the U/B/D/P priority classes.");
  await typeInto(marco, `#petition-${petitionId} form[action="/petitions/update"] input[name="note"]`,
    'Cap raised from 15% to 20% after modelling specialist retention.');
  await submitNear(marco, `#petition-${petitionId} form[action="/petitions/update"] input[name="note"]`);

  // A3.3 — signatures from distinct members carry it across quorum, on their own.
  await signPetition(giulia, 'Conditional intramoenia');
  const signers = ['marco.deluca', 'nadia.hamdi', 'valentina.sanna', 'ahmed.ben.salah', 'anna.conti', 'tommaso.ricci'];
  for (const handle of signers) {
    const page = await member(browser, handle);
    await signPetition(page, 'Conditional intramoenia');
  }

  await visit(giulia, '/petitions');
  await shot(giulia, 'party-signatures', 'Quorum — not an administrator’s opinion — moves a proposal into discussion. Below it, the long-tail land-use proposal sits visible and pending, not buried.', {
    focus: '#petitions-active',
  });

  // A3.10 — establish the recipient's preference before another actor comments.
  await visit(giulia, '/notifications');
  await page_check(giulia, 'input[name="notifyProposalComments"]');
  await submitNear(giulia, 'input[name="notifyProposalComments"]');
  await visit(giulia, '/notifications');
  if (!(await giulia.$eval('input[name="notifyProposalComments"]', (input) => input.checked))) {
    record('Giulia’s proposal comment preference did not persist');
  }

  // A3.4 — the reasonable dissent lands on the text itself.
  const luca = await member(browser, 'luca.esposito');
  await openProposal(luca, petitionId, 'discussion');
  await selectOption(luca, `#petition-${petitionId} select[name="stance"]`, 'concern');
  await typeInto(
    luca,
    `#petition-${petitionId} textarea[name="content"]`,
    'If the cap bites, specialists will move to accredited private providers and public-service waits will worsen. The risk is written into the proposal itself: what concretely offsets it?',
  );
  await submitNear(luca, `#petition-${petitionId} textarea[name="content"]`);

  // Observe delivery and mark the alert read in the author's own session.
  await visit(giulia, '/notifications');
  const commentAlert = `li:has(a[href*="proposal=${petitionId}"][href*="view=discussion"])`;
  const unreadAlert = await giulia.$(commentAlert);
  if (!unreadAlert || !(await unreadAlert.evaluate((row) => row.innerText.includes('Unread')))) {
    record('Giulia did not receive an unread alert linking to the proposal discussion');
  } else {
    ok('Giulia receives a scoped link to Luca’s contribution');
    await submitNear(giulia, 'form[action="/notifications/read"] input[name="page"]');
    await expectText(giulia, '0 unread', 'mark all read clears the unread state');
    if (!(await giulia.$(commentAlert))) record('marking an alert read removed its discussion link');
  }

  // A3.6 — the constitutional lawyer's argument-map node.
  const sofia = await member(browser, 'sofia.bianchi');
  await openProposal(sofia, petitionId, 'discussion');
  await selectOption(sofia, `#petition-${petitionId} select[name="stance"]`, 'concern');
  await typeInto(sofia, `#petition-${petitionId} input[name="argumentTitle"]`, 'Regional competence');
  await typeInto(
    sofia,
    `#petition-${petitionId} textarea[name="content"]`,
    'Healthcare organization is a regional competence under Title V: a national cap by specialty risks a conflict of competences. The realistic lever is national monitoring plus recovery plans, not a uniform constraint.',
  );
  await submitNear(sofia, `#petition-${petitionId} textarea[name="content"]`);
  await expectText(sofia, 'Regional competence', "the constitutional lawyer's argument-map node is recorded");

  // A3.9 — a rebuttal in the tree, not a new thread: Marco picks her node from the map.
  await openProposal(marco, petitionId, 'discussion');
  const parentNode = await marco.evaluate((id) => {
    const options = [...document.querySelectorAll(`#argument-map-${id} option`)];
    return options.find((o) => (o.textContent || '').includes('Regional competence'))?.value || null;
  }, petitionId);
  if (!parentNode) {
    record('the argument map does not offer the "Regional competence" node to build on');
  } else {
    await selectOption(marco, `#petition-${petitionId} select[name="stance"]`, 'support');
    await typeInto(marco, `#petition-${petitionId} input[name="argumentParentId"]`, parentNode);
    await typeInto(
      marco,
      `#petition-${petitionId} textarea[name="content"]`,
      "That is why the proposal attaches to the existing national platform under Law 107/2024: no new competence, only conditions tied to monitoring already in place.",
    );
    await submitNear(marco, `#petition-${petitionId} textarea[name="content"]`);
  }

  // A3.5 — a fact-check request against a specific claim.
  const valentina = await member(browser, 'valentina.sanna');
  await openProposal(valentina, petitionId, 'discussion');
  await selectOption(valentina, `#petition-${petitionId} select[name="stance"]`, 'question');
  await typeInto(
    valentina,
    `#petition-${petitionId} textarea[name="content"]`,
    'The survey covers 14 health authorities out of more than 100: is that a sufficient sample for a national cap? I request a review of the sampling method.',
  );
  await page_check(valentina, `#petition-${petitionId} input[name="factCheck"]`);
  await submitNear(valentina, `#petition-${petitionId} textarea[name="content"]`);

  await openProposal(giulia, petitionId, 'discussion');
  await openDetails(giulia, 'Argument map (', { scope: `#petition-${petitionId}` });
  await shot(giulia, 'party-deliberation', 'Deliberation is stance-tagged and mapped: a constitutional-law objection as an argument node with the economist’s rebuttal under it, the restaurateur’s concern, and a fact-check request on a specific claim — the shape of the disagreement, not a flat thread.', {
    focus: `#petition-${petitionId}`,
  });

  // A3.11 — the author answers the concerns in the text itself.
  await openProposal(giulia, petitionId);
  await typeInto(giulia, `#petition-${petitionId} form[action="/petitions/update"] textarea[name="risks"]`,
    'Specialists may leave for accredited private providers (raised by @luca.esposito). The cap only bites after incentives for public-service activity are funded, so capacity is added before it is constrained.');
  await typeInto(giulia, `#petition-${petitionId} form[action="/petitions/update"] textarea[name="implementationPlan"]`,
    'Fund public-service incentives first; measure at three months on the national platform; trial the cap in two pilot health authorities at six months; review at twelve. The sampling method of the 14-authority survey is annexed (requested by @valentina.sanna).');
  await typeInto(giulia, `#petition-${petitionId} form[action="/petitions/update"] input[name="note"]`,
    'Answers the retention concern and the sampling fact-check: incentives funded before the cap bites; method annexed.');
  await submitNear(giulia, `#petition-${petitionId} form[action="/petitions/update"] input[name="note"]`);

  await openProposal(giulia, petitionId, 'history');
  await expectText(giulia, 'incentives funded before the cap bites', 'the revision note records why the text changed');
  await shot(giulia, 'party-revisions', 'Deliberation visibly changed the text: the version history runs draft → the economist’s cap revision → the author’s answer to the concerns, each revision attributed and diffable.', {
    focus: `#petition-${petitionId}`,
  });

  return petitionId;
}

/** Ticks a checkbox by selector, revealing any collapsed disclosure above it first. */
async function page_check(page, selector) {
  if (!(await reveal(page, selector))) return false;
  return page.evaluate((sel) => {
    const box = document.querySelector(sel);
    if (!box) return false;
    if (!box.checked) box.click();
    return true;
  }, selector);
}

/** A3.15 — The long-tail proposal that stays below quorum on purpose. */
async function journeyLongTail(browser) {
  console.log('\n— long tail: a proposal below quorum, visible and pending');
  const davide = await member(browser, 'davide.villa');
  await visit(davide, '/petitions');
  await typeInto(davide, '#petitions-compose input[name="title"]', 'Stop net land consumption around the Cuneo logistics corridor');
  await typeInto(davide, '#petitions-compose input[name="topic"]', TOPIC.landUse);
  await typeInto(davide, '#petitions-compose input[name="quorum"]', '12');
  await typeInto(
    davide,
    '#petitions-compose textarea[name="summary"]',
    'A municipal moratorium on sealing agricultural land for logistics hubs until a national land-consumption law exists.',
  );
  await typeInto(
    davide,
    '#petitions-compose textarea[name="problem"]',
    'ISPRA: about 20 hectares consumed per day; the national framework bill has been stalled for more than ten years.',
  );
  await submitNear(davide, '#petitions-compose input[name="title"]');
  await expectText(davide, 'land consumption', 'the long-tail proposal is drafted');
  // A couple of signatures, deliberately short of quorum.
  await signPetition(davide, 'Cuneo logistics corridor');
  const paolo = await member(browser, 'paolo.greco');
  await signPetition(paolo, 'Cuneo logistics corridor');
}

/** A3.7/A3.8 — Opening a vote is an attributed act; the tally shows the dissent. */
async function journeyVote(browser, petitionId) {
  console.log('\n— vote: an attributed freeze, then a tally that shows the no');
  if (!petitionId) {
    record('no proposal to vote on (drafting failed earlier)');
    return;
  }

  // The author cannot open a vote on their own proposal.
  const giulia = await member(browser, 'giulia.ferrero');
  await openProposal(giulia, petitionId);
  const authorSeesFreeze = await giulia.$(`#petition-${petitionId} form[action="/petitions/status"]`);
  if (authorSeesFreeze) record('the author is offered the freeze/status control on her own proposal');
  else ok('opening a vote is not offered to the author');

  // The party secretary — a moderator, not the provider — freezes and opens it.
  // Set status, tick the freeze confirmation, and submit the form in one step so the
  // confirmFreeze value is serialized with the enhanced POST.
  const elena = await member(browser, 'elena.rossi');
  await openProposal(elena, petitionId);
  const froze = await elena.evaluate((id) => {
    const card = document.getElementById(`petition-${id}`);
    const form = card?.querySelector('form[action="/petitions/status"]');
    if (!form) return false;
    form.querySelector('select[name="status"]').value = 'vote';
    const confirm = form.querySelector('input[name="confirmFreeze"]');
    if (confirm) confirm.checked = true;
    form.querySelector('button[type="submit"]')?.click();
    return true;
  }, petitionId);
  if (!froze) {
    record('the moderation/freeze form is not offered to the party secretary');
    return;
  }
  await settle(elena);
  await openProposal(elena, petitionId, 'ballot');
  const revisionHref = await elena.$eval('a[href*="#revision-"]', (link) => link.getAttribute('href'));
  await visit(elena, revisionHref);
  await expectText(elena, 'Revision used for the ballot', 'the frozen ballot links to its exact attributed revision');
  await openProposal(elena, petitionId, 'ballot');
  await expectText(elena, 'Frozen at', 'the draft is frozen and the freeze is attributed to the moderator');
  await expectText(elena, 'A 20% cap per specialty', 'the frozen action reflects the economist’s revision');

  // Members vote — and Luca votes no, so the tally is not a rubber stamp.
  const ballots = [
    ['giulia.ferrero', 'yes'],
    ['marco.deluca', 'yes'],
    ['nadia.hamdi', 'yes'],
    ['ahmed.ben.salah', 'yes'],
    ['tommaso.ricci', 'yes'],
    ['luca.esposito', 'no'],
  ];
  for (const [handle, choice] of ballots) {
    const page = await member(browser, handle);
    await openProposal(page, petitionId, 'ballot');
    await selectOption(page, `#petition-${petitionId} form[action="/petitions/vote"] select[name="choice"]`, choice);
    await page.evaluate((id) => {
      const form = document.querySelector(`#petition-${id} form[action="/petitions/vote"]`);
      form?.querySelector('button[type="submit"], button:not([type])')?.click();
    }, petitionId);
    await settle(page);
  }

  await openProposal(giulia, petitionId, 'ballot');
  await expectText(giulia, 'no: 1', 'the tally records the dissenting vote, not only the yeses');
  await shot(giulia, 'party-vote', 'Opening a vote is deliberate and attributed: the text is frozen by the party secretary, and the tally shows the dissent (Luca’s no) instead of a unanimous rubber stamp.', {
    focus: `#petition-${petitionId}`,
  });
}

/** A6 — Liquid delegation, and being able to read it. */
async function journeyDelegation(browser) {
  console.log('\n— delegation: a readable, transitive chain');

  // giulia -> marco, then paolo -> giulia, forming paolo -> giulia -> marco.
  const giulia = await member(browser, 'giulia.ferrero');
  await visit(giulia, '/delegation');
  await typeInto(giulia, 'form[data-enhance="delegation"] input[name="topic"]', TOPIC.waitingLists);
  await typeInto(giulia, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'marco.deluca');
  await submitNear(giulia, 'form[data-enhance="delegation"] input[name="delegateHash"]');

  const paolo = await member(browser, 'paolo.greco');
  await visit(paolo, '/delegation');
  await typeInto(paolo, 'form[data-enhance="delegation"] input[name="topic"]', TOPIC.waitingLists);
  await typeInto(paolo, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'giulia.ferrero');
  await submitNear(paolo, 'form[data-enhance="delegation"] input[name="delegateHash"]');
  await expectText(paolo, 'marco.deluca', 'the transitive chain resolves through to the end delegate');
  await shot(paolo, 'party-delegation', 'Liquid delegation you can read: paolo → giulia → marco on one topic, chosen by @handle and never by raw hash, with the “explain my influence” chain stating where the vote ends up.', {
    focus: '[data-composer-section="delegation-effective"]',
  });
}

/** A5 — A ranked group election, won on transfers against the first-preference leader. */
async function journeyElection(browser) {
  console.log('\n— groups: a ranked election won on transfers');
  const irene = await member(browser, 'irene.fabbri');
  await visit(irene, '/groups');
  await typeInto(irene, '[data-composer-section="groups-create"] input[name="name"]', CIRCLE_NAME);
  await typeInto(irene, '[data-composer-section="groups-create"] input[name="topics"]', `${TOPIC.waitingLists},${TOPIC.minimumWage}`);
  await typeInto(irene, '[data-composer-section="groups-create"] textarea[name="description"]', 'Delegates and priorities on waiting times and healthcare work.');
  await submitNear(irene, '[data-composer-section="groups-create"] input[name="name"]');
  const created = await expectText(irene, CIRCLE_NAME, 'the group is created');
  if (!created) return;

  const groupId = new URL(irene.url()).searchParams.get('group');
  if (!groupId) {
    record('the create form did not open the new group workspace');
    return;
  }

  await setGroupPolicy(irene, groupId, { electionMode: 'vote', conflictRule: 'prompt_user' });

  // Members join so the ballots below are cast by genuinely distinct sessions.
  const voters = ['marco.deluca', 'giulia.ferrero', 'valentina.sanna', 'tommaso.ricci', 'davide.villa', 'ahmed.ben.salah', 'luca.esposito', 'nadia.hamdi', 'anna.conti', 'paolo.greco'];
  for (const handle of voters) {
    await joinGroup(await member(browser, handle), groupId);
  }

  // irene starts the election by @handle (the controller resolves to hashes).
  await visit(irene, `/groups?group=${groupId}&view=decisions`);
  await irene.evaluate((id, topic) => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="startElection"]') && f.querySelector(`input[name="groupId"][value="${id}"]`));
    form?.closest('details')?.setAttribute('open', 'open');
    if (form) {
      form.querySelector('input[name="topic"]').value = topic;
      form.querySelector('input[name="candidates"]').value = 'giulia.ferrero, marco.deluca, valentina.sanna';
      form.querySelector('button[type="submit"]').click();
    }
  }, groupId, TOPIC.waitingLists);
  await settle(irene);

  // The canonical ballots (A5.5): 4 marco, 3 giulia>valentina, 2 valentina>giulia.
  const ballots = [
    ['tommaso.ricci', 'marco.deluca', null],
    ['davide.villa', 'marco.deluca', null],
    ['ahmed.ben.salah', 'marco.deluca', null],
    ['luca.esposito', 'marco.deluca', null],
    ['giulia.ferrero', 'giulia.ferrero', 'valentina.sanna'],
    ['nadia.hamdi', 'giulia.ferrero', 'valentina.sanna'],
    ['paolo.greco', 'giulia.ferrero', 'valentina.sanna'],
    ['valentina.sanna', 'valentina.sanna', 'giulia.ferrero'],
    ['anna.conti', 'valentina.sanna', 'giulia.ferrero'],
  ];
  for (const [handle, first, second] of ballots) {
    const page = await member(browser, handle);
    await visit(page, `/groups?group=${groupId}&view=decisions`);
    await selectOptionByLabel(page, 'form select[name="candidateHash"]', first);
    if (second) await selectOptionByLabel(page, 'form select[name="secondChoiceHash"]', second);
    await page.evaluate(() => {
      const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="voteElection"]'));
      form?.querySelector('button[type="submit"]')?.click();
    });
    await settle(page);
  }

  // irene closes it and reads the outcome in Decisions.
  await visit(irene, `/groups?group=${groupId}&view=decisions`);
  await irene.evaluate(() => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="closeElection"]'));
    form?.querySelector('button[type="submit"]')?.click();
  });
  await settle(irene);
  await visit(irene, `/groups?group=${groupId}&view=decisions`);
  await expectText(irene, 'giulia.ferrero', 'the winner surfaces in Decisions');
  await expectText(irene, 'rounds 2', 'the election was decided on a second-round transfer');
  await shot(irene, 'party-election', 'A ranked delegate election, won on transfers: the first-preference leader (the economist, most delegated weight in the party) loses to the frontline nurse once eliminated ballots transfer — method ranked, rounds 2.', {
    focus: '[data-composer-section="group-decisions"]',
  });
}

/** Reads the group id from its directory link. */
async function findGroupIdByName(page, name) {
  return page.evaluate((want) => {
    const cards = [...document.querySelectorAll('article')];
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').toLowerCase().includes(want.toLowerCase()));
    const link = card?.querySelector('h3 a');
    return link ? new URL(link.href).searchParams.get('group') : null;
  }, name);
}

async function joinGroup(page, groupId) {
  await visit(page, `/groups?group=${groupId}`);
  await page.evaluate((id) => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find(
      (f) => f.querySelector('input[name="action"][value="join"]') && f.querySelector(`input[name="groupId"][value="${id}"]`),
    );
    form?.querySelector('button[type="submit"]')?.click();
  }, groupId);
  await settle(page);
}

/** Applies a group's policy form (lanes, visibility, election mode, roll-up) in one submit. */
async function setGroupPolicy(page, groupId, patch) {
  await visit(page, `/groups?group=${groupId}&view=settings`);
  const applied = await page.evaluate(
    (id, values) => {
      const form = [...document.querySelectorAll('form[action="/groups/policy"]')].find((f) =>
        f.querySelector(`input[name="groupId"][value="${id}"]`),
      );
      if (!form) return false;
      form.closest('details')?.setAttribute('open', 'open');
      for (const [name, value] of Object.entries(values)) {
        const field = form.querySelector(`[name="${name}"]`);
        if (!field) continue;
        if (field.type === 'checkbox') field.checked = Boolean(value);
        else field.value = value;
      }
      form.querySelector('button[type="submit"]')?.click();
      return true;
    },
    groupId,
    patch,
  );
  if (!applied) record(`no policy form for group ${groupId}`);
  await settle(page);
  return applied;
}

/**
 * A9 — Structure that grows a branch. A party circle gains a topic-focused workshop
 * beneath it, both declare the categories they work on, and the directory turns that into
 * an answer to "who do I delegate this to?" — the question topic-scoped delegation asks of
 * every member and, before this, left them to answer alone.
 */
async function journeyBranchGroups(browser) {
  console.log('\n— branches: a workshop inside the party, and a category directory');
  const irene = await member(browser, 'irene.fabbri');
  await visit(irene, '/groups');

  const parentId = await findGroupIdByName(irene, CIRCLE_NAME);
  if (!parentId) {
    record('the parent circle from the election journey is missing');
    return null;
  }

  // The parent declares the broad categories it covers.
  await visit(irene, `/groups?group=${parentId}&view=settings`);
  await irene.evaluate((id, topics) => {
    const form = [...document.querySelectorAll('form[action="/groups/topics"]')].find((f) =>
      f.querySelector(`input[name="groupId"][value="${id}"]`),
    );
    if (form) {
      form.closest('details')?.setAttribute('open', 'open');
      form.querySelector('input[name="topics"]').value = topics;
      form.querySelector('button[type="submit"]').click();
    }
  }, parentId, `${CATEGORY.health}, ${CATEGORY.labour}`);
  await settle(irene);

  // The branch: narrower, with its own subcategory and its own membership.
  await visit(irene, '/groups');
  await typeInto(irene, '[data-composer-section="groups-create"] input[name="name"]', BRANCH_NAME);
  await typeInto(irene, '[data-composer-section="groups-create"] input[name="topics"]', CATEGORY.waitingLists);
  await selectOptionByLabel(irene, '[data-composer-section="groups-create"] select[name="parentId"]', CIRCLE_NAME);
  await typeInto(
    irene,
    '[data-composer-section="groups-create"] textarea[name="description"]',
    'A topic branch of the Circle: works only on waiting times and intramoenia.',
  );
  await submitNear(irene, '[data-composer-section="groups-create"] input[name="name"]');

  await visit(irene, '/groups');
  const branchId = await findGroupIdByName(irene, BRANCH_NAME);
  if (!branchId) {
    record('the branch group was not created');
    return null;
  }
  await expectText(irene, `Branch of ${CIRCLE_NAME}`, 'the branch shows its lineage, not just a name');
  await visit(irene, `/groups?group=${parentId}`);
  await expectText(irene, BRANCH_NAME, 'the parent links to its branch');
  await visit(irene, `/groups?group=${branchId}&view=settings`);
  const branchCategories = await irene.$eval('form[action="/groups/topics"] input[name="topics"]', (input) => input.value);
  if (branchCategories.includes(CATEGORY.waitingLists)) ok('the branch declares its own subcategory at creation');
  else record(`the branch declared "${branchCategories}" instead of ${CATEGORY.waitingLists}`);

  // The branch puts the elected nurse forward on its own subcategory.
  await irene.evaluate((id, topic) => {
    const form = [...document.querySelectorAll('form[action="/groups/delegate"]')].find((f) =>
      f.querySelector(`input[name="groupId"][value="${id}"]`),
    );
    if (form) {
      form.closest('details')?.setAttribute('open', 'open');
      form.querySelector('input[name="topic"]').value = topic;
      form.querySelector('input[name="delegateHash"]').value = 'giulia.ferrero';
      form.querySelector('input[name="priority"]').value = '1';
      form.querySelector('button[type="submit"]').click();
    }
  }, branchId, CATEGORY.waitingLists);
  await settle(irene);

  await visit(irene, '/groups');
  await shot(
    irene,
    'party-branch-groups',
    'Structure grows a branch: a topic-focused workshop sits under the party circle, indented and labelled “Branch of”. Nesting is structural, not authority — the branch keeps its own membership and its own delegate cachets.',
    { focus: '[data-composer-section="groups-list"]' },
  );

  await expectText(irene, CATEGORY.waitingLists, 'the branch subcategory reaches the directory');
  await shot(
    irene,
    'party-categories',
    'Who works on what: every category a group has declared, the circles covering it, and who each currently puts forward — with one-click delegation. This is the answer to the question topic-scoped delegation asks and used to leave to the member.',
    { focus: '[data-composer-section="groups-categories"]' },
  );

  return { parentId, branchId };
}

/**
 * A10 — An internal lane, and the path out of it. A branch can hold its own working
 * discussion without publishing every note to the whole party; an ordinary member can ask
 * for one to be taken up a level, and a lane moderator — not only an admin — decides.
 */
async function journeyGroupLane(browser, ids) {
  console.log('\n— lanes: an internal branch discussion, and a member asking to move it up');
  if (!ids?.branchId) {
    record('no branch group to open a lane on');
    return;
  }
  const { parentId, branchId } = ids;
  const irene = await member(browser, 'irene.fabbri');
  const noteNeedle = 'branch working note';

  // Both levels open their internal discussion lane, members-only.
  await setGroupPolicy(irene, branchId, {
    electionMode: 'priority',
    conflictRule: 'highest_priority',
    laneDiscussion: true,
    lanesVisibility: 'members',
  });
  await setGroupPolicy(irene, parentId, {
    electionMode: 'vote',
    conflictRule: 'prompt_user',
    laneDiscussion: true,
    lanesVisibility: 'members',
    adoptBranchElections: true,
  });

  for (const handle of ['nadia.hamdi', 'tommaso.ricci', 'sofia.bianchi']) {
    await joinGroup(await member(browser, handle), branchId);
  }

  // sofia moderates the lane without being able to change what the group *is*.
  await visit(irene, `/groups?group=${branchId}&view=members`);
  const roleSet = await irene.evaluate(
    (id, handleFragment) => {
      const forms = [...document.querySelectorAll('form[action="/groups/roles"]')].filter((f) =>
        f.querySelector(`input[name="groupId"][value="${id}"]`),
      );
      const row = forms.find((f) => (f.closest('.list-row')?.textContent || '').toLowerCase().includes(handleFragment));
      if (!row) return false;
      row.closest('details')?.setAttribute('open', 'open');
      row.querySelector('select[name="role"]').value = 'laneModerator';
      row.querySelector('button[type="submit"]').click();
      return true;
    },
    branchId,
    'sofia',
  );
  if (!roleSet) record('the branch roles panel did not offer sofia a role control');
  await settle(irene);

  await expectText(irene, 'Members and roles', 'the role change returns to Members');
  await shot(irene, 'party-group-members', 'The branch has a separate roster and role controls for its administrators.');

  // A working note that belongs to the branch, not yet to the party.
  const nadia = await member(browser, 'nadia.hamdi');
  await visit(nadia, `/groups?group=${branchId}`);
  await expectText(nadia, 'Members-only lanes', 'the group workspace states the lane visibility');
  await shot(nadia, 'party-group-overview', 'A branch workspace shows its lineage, membership, categories, and the available group discussion lane.');
  await clickText(nadia, 'main a', 'Group discussion');
  await settle(nadia);
  await typeInto(nadia, '#discussion-compose input[name="topic"]', CATEGORY.waitingLists);
  await selectOptionByLabel(nadia, '#discussion-compose select[name="groupId"]', BRANCH_NAME);
  await selectOption(nadia, '#discussion-compose select[name="stance"]', 'proposal');
  await typeInto(
    nadia,
    '#discussion-compose textarea[name="content"]',
    'Branch working note: for priority class B, the Palermo CUP overshoots the PNGLA limit by 41%. Before we take this to the Circle, let us check the data from three other health authorities.',
  );
  await submitNear(nadia, '#discussion-compose textarea[name="content"]');

  await visit(nadia, `/discussion?group=${branchId}`);
  await expectText(nadia, noteNeedle, 'the branch lane carries the working note');
  await shot(
    nadia,
    'party-group-lane',
    'An optional internal lane: the branch works in its own discussion, members-only and off by default. Notes here stay out of the party-wide feed until someone moves them up — so a working draft is not a public position.',
    { focus: '[data-composer-section="discussion-feed"]' },
  );

  // A note posted in a branch lane must not leak into the Circle-wide feed.
  await visit(nadia, '/discussion');
  const leaked = (await pageText(nadia)).toLowerCase().includes(noteNeedle);
  if (leaked) record('a branch-lane note leaked into the Circle-wide discussion feed');
  else ok('the branch note stays out of the Circle-wide feed');

  // tommaso is a plain member: he can ask, not decide.
  const tommaso = await member(browser, 'tommaso.ricci');
  await visit(tommaso, `/discussion?group=${branchId}`);
  await typeInto(
    tommaso,
    'form[data-enhance="promotion-request"] input[name="note"]',
    'The data holds up: this concerns the whole Circle, not just the branch.',
  );
  await submitNear(tommaso, 'form[data-enhance="promotion-request"] input[name="note"]');
  await visit(tommaso, `/discussion?group=${branchId}`);
  await expectText(tommaso, 'asked for this to move up', 'the request is visible to the whole branch, not a private ping');

  // sofia — lane moderator, not admin — decides.
  const sofia = await member(browser, 'sofia.bianchi');
  await visit(sofia, `/discussion?group=${branchId}`);
  await expectText(sofia, `Approve move to ${CIRCLE_NAME}`, 'the approval names the destination before the move');
  const approved = await sofia.evaluate(() => {
    const form = document.querySelector('form[data-enhance="promotion-decision"]');
    const button = [...(form?.querySelectorAll('button') || [])].find((b) => b.value === 'approve');
    if (!button) return false;
    button.click();
    return true;
  });
  if (!approved) record('the lane moderator was not offered the approve control');
  await settle(sofia);

  // First verify the boundary: sofia moderates the branch but never joined the parent,
  // and the parent's lane is members-only — so she should not be able to read it.
  await visit(sofia, `/discussion?group=${parentId}`);
  const moderatorCanRead = (await pageText(sofia)).toLowerCase().includes(noteNeedle);
  if (moderatorCanRead) record('a branch moderator can read the parent circle’s members-only lane');
  else ok('the parent circle’s lane stays closed to a non-member, even a branch moderator');

  // Then read the result as someone who is actually in the parent circle.
  await visit(irene, `/discussion?group=${parentId}`);
  await expectText(irene, noteNeedle, 'the approved note now sits in the parent circle’s lane');
  await expectText(irene, 'Promoted from', 'the move is stamped on the item, not silent');
  await shot(
    irene,
    'party-promotion',
    'A member asks, a lane moderator decides: the branch note is moved up to the parent circle and stamped “Promoted from …”. It is a move, not a copy — the thread keeps its id, so its replies travel with it and a decline would have carried a reason.',
    { focus: '[data-composer-section="discussion-feed"]' },
  );
}

/**
 * A11 — Handing a vote to a delegate, honestly. A delegation on the *parent* category
 * reaches a proposal filed in a subcategory, the ballot stays visibly uncounted while the
 * delegate still has time, and the delegate can see what is riding on them.
 */
async function journeyDelegatedBallot(browser) {
  console.log('\n— delegated ballots: a category delegation, a deadline, and an override');

  // davide delegates the broad category; the proposal below is filed under a subcategory of it.
  const davide = await member(browser, 'davide.villa');
  await visit(davide, '/delegation');
  await typeInto(davide, 'form[data-enhance="delegation"] input[name="topic"]', CATEGORY.health);
  await typeInto(davide, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'giulia.ferrero');
  await submitNear(davide, 'form[data-enhance="delegation"] input[name="delegateHash"]');

  // A proposal whose category the author chooses — narrower than the delegation above.
  const nadia = await member(browser, 'nadia.hamdi');
  await visit(nadia, '/petitions');
  await typeInto(nadia, '#petitions-compose input[name="title"]', 'Enforce the 10-day limit for class B referrals in Sicilian health authorities');
  // Filed under primary care, a sibling of the waiting-list subcategory: davide's parent
  // delegation reaches it, while giulia's own waiting-list delegation (to marco) does not,
  // so the ballot stops with her and her inbox shows it.
  await typeInto(nadia, '#petitions-compose input[name="topic"]', TOPIC.primaryCare);
  await typeInto(nadia, '#petitions-compose input[name="quorum"]', '1');
  await typeInto(
    nadia,
    '#petitions-compose textarea[name="summary"]',
    'Apply the PNGLA 10-day limit to class B referrals and publish each health authority’s monthly overshoot.',
  );
  await submitNear(nadia, '#petitions-compose input[name="title"]');
  await expectText(nadia, TOPIC.primaryCare, 'the proposal keeps the category its author chose');

  const petitionId = await findPetitionId(nadia, 'class B referrals');
  if (!petitionId) {
    record('could not locate the subcategory proposal');
    return;
  }
  await signPetition(nadia, 'class B referrals');

  // The party secretary freezes and opens it.
  const elena = await member(browser, 'elena.rossi');
  await openProposal(elena, petitionId);
  await elena.evaluate((id) => {
    const form = document.getElementById(`petition-${id}`)?.querySelector('form[action="/petitions/status"]');
    if (!form) return;
    form.querySelector('select[name="status"]').value = 'vote';
    const confirm = form.querySelector('input[name="confirmFreeze"]');
    if (confirm) confirm.checked = true;
    form.querySelector('button[type="submit"]')?.click();
  }, petitionId);
  await settle(elena);

  // davide hands the ballot to whoever his category delegation resolves to.
  await openProposal(davide, petitionId, 'ballot');
  await selectOption(davide, `#petition-${petitionId} form[action="/petitions/vote"] select[name="choice"]`, 'auto');
  await davide.evaluate((id) => {
    const form = document.querySelector(`#petition-${id} form[action="/petitions/vote"]`);
    form?.querySelector('button[type="submit"], button:not([type])')?.click();
  }, petitionId);
  await settle(davide);

  await openProposal(davide, petitionId, 'ballot');
  await expectText(davide, 'giulia.ferrero', 'the delegation on the parent category reaches the subcategory proposal');
  await expectText(davide, 'awaiting delegates', 'an open delegated ballot is reported apart from the abstentions');
  await shot(
    davide,
    'party-delegated-ballot',
    'A delegated vote is a real ballot, not an abstention: davide delegated the broad category “Healthcare”, and it reaches a proposal filed under “Healthcare / Primary care”. Until @giulia.ferrero votes it is counted as nothing — shown as “awaiting delegates”, never folded into the abstentions — and he can override it himself at any time.',
    { focus: `#petition-${petitionId}` },
  );

  // The other side of the contract: the delegate can see what is riding on her.
  const giulia = await member(browser, 'giulia.ferrero');
  await visit(giulia, '/delegation');
  await expectText(giulia, 'class B referrals', 'the delegate sees the ballot handed to her');
  await expectText(giulia, 'left', 'the delegate sees how long she has to act');
  await shot(
    giulia,
    'party-delegate-inbox',
    'The delegate’s side of the same contract: ballots handed to her, what each is about, and how many days remain before one lapses to an abstention. Delegation stops being something that happens to a delegate without their knowledge.',
    { focus: '[data-composer-section="delegation-inbox"]' },
  );
}

/** A8 — Accountability without compulsion: the People directory and a delegate dashboard. */
async function journeyAccountability(browser) {
  console.log('\n— accountability: the People directory and a delegate dashboard');
  const marco = await member(browser, 'marco.deluca');
  // Members find delegates by browsing people, never by pasting a hash.
  await visit(marco, '/delegates');
  await expectText(marco, 'marco.deluca', 'the People directory lists the delegate by handle');
  await shot(marco, 'party-delegates', 'Members discover delegates by browsing people, never by pasting hashes: the directory ranks delegates and shows role and delegation counts.', {
    focus: '[data-composer-section="delegate-directory-list"]',
  });

  // Open Marco's accountability dashboard: delegations received/set, vote history, and
  // (after A5) a lost election on the record next to the accumulated delegations.
  const href = await marco.evaluate(() => {
    const rows = [...document.querySelectorAll('.person-card')];
    const row = rows.find((r) => (r.textContent || '').toLowerCase().includes('marco.deluca'));
    return row?.querySelector('a[href^="/delegates/"]')?.getAttribute('href') || null;
  });
  if (href) {
    await visit(marco, href);
    await expectText(marco, 'Delegations received', 'the delegate profile is the soft-power accountability dashboard');
    await expectText(marco, 'I publish my models', 'the delegate’s provider-local public bio is on the dashboard');
    await shot(marco, 'party-delegate-profile', 'Soft-power accountability, not compulsion: a delegate’s public dashboard — delegations received and set, vote history, group endorsements, and an advisory (never binding) deliberation score.', {
      focus: 'main',
    });
  } else {
    record('no profile link for @marco.deluca in the People directory');
  }
}

/**
 * A9 — Governance changes itself. A member proposes a change to the digital constitution,
 * motivated by the long-tail proposal the uniform quorum is starving; the provider decides
 * it in /admin, and the decision enters public history. The fixture keeps the tension
 * visible: today that decision is an operator act, not a member vote.
 */
async function journeyGovernance(browser) {
  console.log('\n— governance: a member proposes a constitutional change');
  const title = 'Reduced quorum for proposals with regional impact';
  const tommaso = await member(browser, 'tommaso.ricci');
  await visit(tommaso, '/governance');
  await typeInto(tommaso, 'input[name="governanceProposalTitle"]', title);
  await typeInto(tommaso, 'input[name="governanceProposalQuorumDefault"]', '120');
  await typeInto(
    tommaso,
    'textarea[name="governanceProposalReason"]',
    'A land-consumption proposal in one municipality cannot reasonably collect 250 national signatures: a uniform quorum kills the long tail.',
  );
  await submitNear(tommaso, 'input[name="governanceProposalTitle"]');
  await visit(tommaso, '/governance');
  if (!(await expectText(tommaso, title, 'the change proposal is open and public'))) return;

  const admin = await providerAdmin(browser);
  await visit(admin, '/admin');
  const decided = await admin.evaluate((want) => {
    const forms = [...document.querySelectorAll('form')].filter((f) =>
      f.querySelector('input[name="intent"][value="governance-proposal-decision"]'),
    );
    const form = forms.find((f) => (f.closest('li')?.textContent || '').includes(want));
    const button = form && [...form.querySelectorAll('button')].find((b) => b.value === 'approve');
    if (!button) return false;
    button.scrollIntoView({ block: 'center' });
    button.click();
    return true;
  }, title);
  if (!decided) {
    record('the provider was not offered an approve control for the governance proposal');
    return;
  }
  await settle(admin);

  await visit(tommaso, '/governance');
  await expectText(tommaso, '120 signatures', 'the accepted proposal updates the constitution defaults');
  await shot(tommaso, 'party-governance', 'Governance changes itself: a member proposes lowering the default quorum because the uniform one starves the long tail; the decision and its reason enter public history. The tension stays visible — today the provider decides, and whether that should become a member vote is an open design question.', {
    focus: 'main',
  });
}

/**
 * A2.7/A2.14 — the social lane stays social. Short attributed updates, typed follow
 * edges, and a reshare-with-comment, so the "small talk + info" lane is populated and a
 * screenshot can show at a glance that a social post is not a vote. The feed is scoped to
 * followed handles, so one member (Anna, the high-activity student) follows the active
 * posters and we shoot *her* wall.
 */
async function journeySocial(browser) {
  console.log('\n— social: the lane stays social (posts, typed follows, a reshare)');
  const freeMandateUpdate = 'I wrote about the free mandate in Forum. Article 67 gives us a way to hold representatives accountable without turning the party into a whip.';
  const posts = [
    ['anna.conti', 'Referendum night at the stalls: low turnout, but plenty of under-30s asking about ius scholae. The issue is there; the law is not.'],
    ['giulia.ferrero', 'Ward full again today. The intramoenia proposal is almost ready, though — if your circle still has signatures to collect, now is the time.'],
    ['valentina.sanna', 'For everyone asking where the waiting-list numbers come from: the internal survey of 14 health authorities, not the regional portals. Comparison next week.'],
    ['tommaso.ricci', 'From Trento: circle meeting on Thursday about autonomy. I am bringing the LEP data, not slogans.'],
    ['nadia.hamdi', 'From Sicily: the same CUP waiting times people describe in the North. It is not a local emergency; it is the system.'],
    ['ahmed.ben.salah', 'Shift over. Thanks to everyone who came to the picket this morning — there were a lot of us.'],
    ['paolo.greco', 'Verified at the circle office, with some help from the young ones. Count me in.'],
    ['anna.conti', 'Reminder: ius scholae assembly on Wednesday, remote attendance too. Bring questions, not flags.'],
    ['valentina.sanna', 'Chart of PNGLA waiting times by priority class coming soon. Follow me on “interest” if you want the preview.'],
    ['luca.esposito', 'I do not agree with everything here, but the level of debate is something else compared with the usual social groups. People actually argue.'],
    ['sofia.bianchi', freeMandateUpdate],
  ];
  for (const [handle, content] of posts) {
    const page = await member(browser, handle);
    await socialPost(page, { content });
  }

  // Anna follows the active posters, with typed edges, so her wall is populated.
  const anna = await member(browser, 'anna.conti');
  const follows = [
    ['giulia.ferrero', 'circle'],
    ['valentina.sanna', 'interest'],
    ['tommaso.ricci', 'info'],
    ['nadia.hamdi', 'interest'],
    ['ahmed.ben.salah', 'alerts'],
    ['paolo.greco', 'circle'],
    ['luca.esposito', 'circle'],
    ['sofia.bianchi', 'info'],
  ];
  for (const [handle, type] of follows) {
    await follow(anna, { handle, type });
  }

  // A2.14 — Luca reshares Sofia's article update.
  const luca = await member(browser, 'luca.esposito');
  await follow(luca, { handle: 'sofia.bianchi', type: 'info' });
  await visit(luca, '/social/feed');
  const original = await luca.$$eval('.social-post', (cards, update) =>
    cards.find((card) => card.querySelector('.topic-body > p')?.textContent === update)?.id,
  freeMandateUpdate);
  const commentary = 'Read this before talking about an “imperative mandate” at the bar.';
  if (original) {
    const field = `#${original} form[data-enhance="social-reshare"] textarea`;
    await typeInto(luca, field, commentary);
    await submitNear(luca, field);
  } else {
    record('Luca could not find Sofia’s free-mandate update');
  }

  await visit(anna, '/social/feed');
  await expectText(anna, 'ius scholae', 'the social lane is populated and scoped to followed people');
  const reshareMatches = await anna.$$eval('.social-post', (cards, note) =>
    cards.some((card) => card.querySelector('.topic-author .actor')?.textContent === '@luca.esposito' &&
      card.querySelector('.topic-body > p')?.textContent === note &&
      card.querySelector('.callout .actor')?.textContent === '@sofia.bianchi'),
  commentary);
  if (reshareMatches) ok('Luca’s commentary attributes Sofia’s original update');
  else record('Anna did not see Luca’s attributed reshare of Sofia’s update');
  await shot(anna, 'party-social', 'The social lane stays social: short attributed updates from followed people, typed follows (circle/interest/info/alerts), and a reshare — visibly not a vote.', {
    focus: '.page-grid--social .page-main',
  });
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
    if (wanted('arrive')) await journeyArrive(browser);
    if (wanted('discussion')) await journeyDiscussion(browser);
    if (wanted('forum')) await journeyForum(browser);
    if (wanted('social')) await journeySocial(browser);
    // The long-tail draft is seeded first so it sits, below quorum, beneath the
    // proposal that does reach quorum in the signatures shot.
    if (wanted('longtail')) await journeyLongTail(browser);
    let petitionId = null;
    if (wanted('proposal')) petitionId = await journeyProposal(browser);
    if (wanted('vote')) await journeyVote(browser, petitionId);
    if (wanted('delegation')) await journeyDelegation(browser);
    if (wanted('election')) await journeyElection(browser);
    // Branches build on the circle the election journey created, and the lane journey
    // needs the branch, so these run in order.
    let groupIds = null;
    if (wanted('branches')) groupIds = await journeyBranchGroups(browser);
    if (wanted('lanes')) await journeyGroupLane(browser, groupIds);
    if (wanted('ballots')) await journeyDelegatedBallot(browser);
    if (wanted('accountability')) await journeyAccountability(browser);
    if (wanted('governance')) await journeyGovernance(browser);
    if (wanted('workspace')) {
      const giulia = await member(browser, 'giulia.ferrero');
      await visit(giulia, '/');
      await expectText(giulia, 'Waiting lists', 'Home leads into the party conversation');
      await shot(giulia, 'party-home', 'The member workspace leads with recent conversations and enabled civic work.');
    }
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
    console.log('\nAll party journeys passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
