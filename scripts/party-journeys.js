#!/usr/bin/env node
/**
 * party-journeys — Scenario A: Rete Civica Nazionale
 * --------------------------------------------------
 * Drives the *representative party* half of the framework through the UI, in
 * Italian, the way a member actually uses it: deliberation before any vote, a
 * proposal that earns its way to a ballot, an attributed freeze, a tally that
 * shows the dissent, a readable delegation chain, a ranked election won on
 * transfers, and an accountability trail nobody can quietly rewrite.
 *
 * It is the companion to user-journeys.js (the organization-pressure / care
 * track). Reference: principle-docs/SimulationScenarios.md (Scenario A) and
 * principle-docs/RepresentativeParties.md.
 *
 *   ENFORCE_CIRCLE=true PORT=3000 ./run-standalone.sh                 # terminal 1
 *   BASE_URL=http://127.0.0.1:3000 node scripts/party-journeys.js     # terminal 2
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

async function visit(page, url) {
  await page.bringToFront();
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle0' });
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

/** Signs the proposal card matching `titleFragment` (its Sign button). */
async function signPetition(page, titleFragment) {
  await visit(page, '/petitions');
  const clicked = await page.evaluate((frag) => {
    const cards = [...document.querySelectorAll('[id^="petition-"]')];
    const card = cards.find((c) => (c.textContent || '').toLowerCase().includes(frag.toLowerCase()));
    if (!card) return false;
    const btn = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').trim().toLowerCase().startsWith('sign'));
    if (!btn) return false;
    btn.click();
    return true;
  }, titleFragment);
  await settle(page);
  return clicked;
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

/* --------------------------------------------------------------- journeys */

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
}

/** A2 — Conversation before any vote: three live threads, in Italian. */
async function journeyDiscussion(browser) {
  console.log('\n— discussion: deliberation before any vote');

  // The waiting-list thread: lived experience, corroborated by data, checked.
  const giulia = await member(browser, 'giulia.ferrero');
  await post(giulia, {
    topic: 'liste-attesa',
    stance: 'concern',
    content:
      'Nel mio reparto la prima disponibilità per una visita cardiologica non urgente è a 14 mesi. Chi può permetterselo va in intramoenia e viene visitato in due settimane. Stessa struttura, stessi medici, stesso giorno.',
    evidence: 'https://esempio.rcn.it/liste-attesa/rilevazione-2026',
  });
  await expectText(giulia, '14 mesi', 'a concrete, attributed claim opens the thread');

  const marco = await member(browser, 'marco.deluca');
  await post(marco, {
    topic: 'liste-attesa',
    stance: 'support',
    content:
      'I dati CUP che ho aggregato su tre regioni confermano: per le classi D e P lo sforamento dei tempi PNGLA è la norma, non l’eccezione. Dove l’istituzionale sfora, l’intramoenia della stessa branca è puntuale. Non è un’anomalia locale: è un equilibrio economico.',
  });

  const valentina = await member(browser, 'valentina.sanna');
  await post(valentina, {
    topic: 'liste-attesa',
    stance: 'neutral',
    content:
      'Il dato dei 14 mesi è una mediana o un caso peggiore? Cambia tutto: la mediana descrive il sistema, il caso peggiore descrive una coda. Prima di costruirci una proposta serve la distribuzione, non un aneddoto.',
  });

  const nadia = await member(browser, 'nadia.hamdi');
  await post(nadia, {
    topic: 'liste-attesa',
    stance: 'concern',
    content:
      'Dalla medicina generale: prescrivo in classe di priorità B, che per il PNGLA significa 10 giorni. Il CUP mi propone 96 giorni, oppure il percorso a pagamento della stessa struttura. La classe di priorità è diventata una dichiarazione di intenti.',
  });

  await post(giulia, {
    topic: 'liste-attesa',
    stance: 'neutral',
    content:
      '@valentina.sanna mediana, non caso peggiore: rilevazione interna su 14 aziende, marzo 2026, metodo in allegato. I casi peggiori sono molto oltre.',
    evidence: 'https://esempio.rcn.it/liste-attesa/metodo-rilevazione',
  });

  await visit(giulia, '/discussion');
  await expectText(giulia, 'liste-attesa', 'the waiting-list thread carries five attributed notes');
  await shot(giulia, 'party-discussion', 'Deliberation before any vote: lived experience, corroborated by data and checked — each note stance-tagged and attributed to a verified person.', {
    focus: '.discussion-list',
  });

  // The minimum-wage thread: the dissent has to be reasonable.
  const luca = await member(browser, 'luca.esposito');
  await post(luca, {
    topic: 'salario-minimo',
    stance: 'concern',
    content:
      'Nove euro l’ora lordi per un locale con quattro stagionali significa o alzare i prezzi del 12% o chiudere a novembre. Non sono contrario al salario minimo: sono contrario a farlo senza guardare i margini reali della ristorazione.',
  });
  const ahmed = await member(browser, 'ahmed.ben.salah');
  await post(ahmed, {
    topic: 'salario-minimo',
    stance: 'support',
    content:
      'Nel mio magazzino il contratto pirata paga 6,40 €/ora. Non è concorrenza sui margini, è concorrenza su chi accetta meno. Il salario minimo non chiude le imprese oneste: chiude quelle che campano così.',
  });

  // The split that isn't left-right: a member concedes a point in public.
  const tommaso = await member(browser, 'tommaso.ricci');
  await post(tommaso, {
    topic: 'autonomia-differenziata',
    stance: 'support',
    content:
      'La gestione delle autonomie speciali dimostra che la responsabilità fiscale locale può funzionare. Il problema non è l’autonomia: è farla senza LEP finanziati.',
  });
  await post(nadia, {
    topic: 'autonomia-differenziata',
    stance: 'concern',
    content:
      'Senza LEP finanziati l’autonomia cristallizza la spesa storica: chi ha sempre avuto meno continua ad avere meno, ma stavolta per contratto. La Consulta lo ha detto chiaramente (sent. 192/2024).',
  });
  await post(tommaso, {
    topic: 'autonomia-differenziata',
    stance: 'neutral',
    content:
      'Sui LEP hai ragione, e lo ammetto: senza quelli finanziati la mia posizione non sta in piedi. Ma allora la battaglia è sui LEP, non contro l’autonomia in sé.',
  });
  await visit(tommaso, '/discussion');
  await shot(tommaso, 'party-discussion-concession', 'The split that is not left-right: a member concedes a point in public and the thread survives it.', {
    focus: '.discussion-list',
  });

  // The long tail: one member, one post, a real stake.
  const davide = await member(browser, 'davide.villa');
  await post(davide, {
    topic: 'consumo-suolo',
    stance: 'concern',
    content:
      'ISPRA dice ~20 ettari al giorno di suolo consumato, 2,3 metri quadri al secondo. La legge nazionale è ferma da più di dieci anni. Nel mio comune si impermeabilizza l’ennesima area agricola per logistica. Qualcuno oltre a me ci lavora?',
  });
}

/** A3 — A proposal earns its way to a vote: outline, revision, quorum, argument map. */
async function journeyProposal(browser) {
  console.log('\n— proposal: draft → revise → sign to quorum → deliberate');
  const giulia = await member(browser, 'giulia.ferrero');

  await visit(giulia, '/petitions');
  await typeInto(giulia, '#petitions-compose input[name="title"]', 'Intramoenia condizionata: tetto ALPI dove saltano i tempi PNGLA');
  await typeInto(giulia, '#petitions-compose input[name="quorum"]', '6');
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="summary"]',
    'Nelle branche in cui i tempi istituzionali sforano le classi di priorità PNGLA, l’attività intramoenia della stessa branca scende al 15% dei volumi istituzionali finché i tempi non rientrano.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="problem"]',
    'La legge 120/2007 già vieta che l’ALPI superi i volumi istituzionali, ma il vincolo è aggregato e verificato debolmente. Risultato: la stessa struttura eroga in due settimane a pagamento ciò che eroga in quattordici mesi gratuitamente. Non è una lista d’attesa: è un meccanismo di prezzo.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="proposedAction"]',
    'Tetto del 15% per branca, agganciato al monitoraggio della piattaforma nazionale (L. 107/2024), con sospensione automatica del tetto quando i tempi rientrano nelle classi U/B/D/P.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="impact"]',
    'I pazienti senza disponibilità economica recuperano l’accesso nei tempi di legge; il vincolo già esistente diventa verificabile per branca.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="risks"]',
    'Fuga di specialisti verso il privato puro; il tetto va accompagnato da incentivi sull’attività istituzionale, non da sole sanzioni.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="implementationPlan"]',
    'Rilevazione a 3 mesi sulla piattaforma nazionale; tetto sperimentale in 2 aziende pilota a 6 mesi; revisione a 12.',
  );
  await typeInto(
    giulia,
    '#petitions-compose textarea[name="evidenceSummary"]',
    'Rilevazione RCN su 14 aziende (marzo 2026); istruttoria sui monitoraggi AGENAS; quadro normativo L. 120/2007 e L. 107/2024.',
  );
  await typeInto(giulia, '#petitions-compose textarea[name="evidenceLinks"]', 'https://esempio.rcn.it/liste-attesa/rilevazione-2026');
  await submitNear(giulia, '#petitions-compose input[name="title"]');
  const drafted = await expectText(giulia, 'Intramoenia condizionata', 'the structured proposal appears in the list');
  if (!drafted) return null;

  const petitionId = await findPetitionId(giulia, 'Intramoenia condizionata');
  if (!petitionId) {
    record('could not find the intramoenia proposal id');
    return null;
  }
  await openDetails(giulia, 'Structured outline', { scope: `#petition-${petitionId}` });
  await shot(giulia, 'party-proposal', 'A proposal earns its way to a vote: the structured outline (problem, action, impact, risks, plan) forces the argument to be made, not asserted.', {
    focus: `#petition-${petitionId}`,
  });

  // The economist revises the cap; the change and its author go on the record.
  const marco = await member(browser, 'marco.deluca');
  await visit(marco, '/petitions');
  await typeInto(marco, `#petition-${petitionId} textarea[name="summary"], form[action="/petitions/update"] textarea[name="summary"]`,
    'Tetto portato al 20% per branca dopo modellazione sulla retention degli specialisti; sospensione automatica quando i tempi PNGLA rientrano.');
  await submitNear(marco, 'form[action="/petitions/update"] textarea[name="summary"]');

  // Signatures from distinct members carry it across quorum, on their own.
  await signPetition(giulia, 'Intramoenia condizionata');
  const signers = ['marco.deluca', 'nadia.hamdi', 'valentina.sanna', 'ahmed.ben.salah', 'anna.conti', 'tommaso.ricci'];
  for (const handle of signers) {
    const page = await member(browser, handle);
    await signPetition(page, 'Intramoenia condizionata');
  }

  await visit(giulia, '/petitions');
  await shot(giulia, 'party-signatures', 'Quorum — not an administrator’s opinion — moves a proposal into discussion. Below it, the long-tail land-use proposal sits visible and pending, not buried.', {
    focus: '#petitions-active',
  });

  // Deliberation with an argument map: a lawyer's node, and a rebuttal under it.
  const sofia = await member(browser, 'sofia.bianchi');
  await visit(sofia, '/petitions');
  await selectOption(sofia, `#petition-${petitionId} select[name="stance"]`, 'concern');
  await typeInto(sofia, `#petition-${petitionId} input[name="argumentTitle"]`, 'Competenza regionale');
  await typeInto(
    sofia,
    `#petition-${petitionId} textarea[name="content"]`,
    'L’organizzazione sanitaria è competenza regionale (Titolo V): un tetto nazionale per branca rischia il conflitto di attribuzione. La leva realistica è il monitoraggio nazionale più i piani di rientro.',
  );
  await submitNear(sofia, `#petition-${petitionId} textarea[name="content"]`);
  await expectText(sofia, 'Competenza regionale', "the constitutional lawyer's argument-map node is recorded");

  // Valentina files a fact-check request against a specific claim.
  const valentina = await member(browser, 'valentina.sanna');
  await visit(valentina, '/petitions');
  await selectOption(valentina, `#petition-${petitionId} select[name="stance"]`, 'question');
  await typeInto(
    valentina,
    `#petition-${petitionId} textarea[name="content"]`,
    'La rilevazione copre 14 aziende su oltre 100: campione sufficiente per un tetto nazionale? Chiedo verifica sul metodo di campionamento.',
  );
  await page_check(valentina, `#petition-${petitionId} input[name="factCheck"]`);
  await submitNear(valentina, `#petition-${petitionId} textarea[name="content"]`);

  await visit(giulia, '/petitions');
  await openDetails(giulia, 'Discussion', { scope: `#petition-${petitionId}` });
  await shot(giulia, 'party-deliberation', 'Deliberation is stance-tagged and mapped: a constitutional-law objection as an argument node, a fact-check request on a specific claim — the shape of the disagreement, not a flat thread.', {
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

/** The long-tail proposal that stays below quorum on purpose (A5 fixture target). */
async function journeyLongTail(browser) {
  console.log('\n— long tail: a proposal below quorum, visible and pending');
  const davide = await member(browser, 'davide.villa');
  await visit(davide, '/petitions');
  await typeInto(davide, '#petitions-compose input[name="title"]', 'Stop al consumo di suolo agricolo per logistica nel mio comune');
  await typeInto(davide, '#petitions-compose input[name="quorum"]', '12');
  await typeInto(
    davide,
    '#petitions-compose textarea[name="summary"]',
    'Moratoria comunale sull’impermeabilizzazione di aree agricole per poli logistici finché non esiste una legge nazionale sul consumo di suolo.',
  );
  await typeInto(davide, '#petitions-compose textarea[name="problem"]', 'ISPRA: ~20 ettari al giorno consumati; la legge quadro è ferma da oltre dieci anni.');
  await submitNear(davide, '#petitions-compose input[name="title"]');
  await expectText(davide, 'consumo di suolo', 'the long-tail proposal is drafted');
  // A couple of signatures, deliberately short of quorum.
  await signPetition(davide, 'consumo di suolo');
  const paolo = await member(browser, 'paolo.greco');
  await signPetition(paolo, 'consumo di suolo');
}

/** A8 — Opening a vote is an attributed act; the tally shows the dissent. */
async function journeyVote(browser, petitionId) {
  console.log('\n— vote: an attributed freeze, then a tally that shows the no');
  if (!petitionId) {
    record('no proposal to vote on (drafting failed earlier)');
    return;
  }

  // The author cannot open a vote on their own proposal.
  const giulia = await member(browser, 'giulia.ferrero');
  await visit(giulia, '/petitions');
  const authorSeesFreeze = await giulia.$(`#petition-${petitionId} form[action="/petitions/status"]`);
  if (authorSeesFreeze) record('the author is offered the freeze/status control on her own proposal');
  else ok('opening a vote is not offered to the author');

  // The party secretary — a moderator, not the provider — freezes and opens it.
  // Set status, tick the freeze confirmation, and submit the form in one step so the
  // confirmFreeze value is serialized with the enhanced POST.
  const elena = await member(browser, 'elena.rossi');
  await visit(elena, '/petitions');
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
  await visit(elena, '/petitions');
  await expectText(elena, 'Frozen at', 'the draft is frozen and the freeze is attributed to the moderator');

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
    await visit(page, '/petitions');
    await selectOption(page, `#petition-${petitionId} form[action="/petitions/vote"] select[name="choice"]`, choice);
    await page.evaluate((id) => {
      const form = document.querySelector(`#petition-${id} form[action="/petitions/vote"]`);
      form?.querySelector('button[type="submit"], button:not([type])')?.click();
    }, petitionId);
    await settle(page);
  }

  await visit(giulia, '/petitions');
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
  await typeInto(giulia, 'form[data-enhance="delegation"] input[name="topic"]', 'liste-attesa');
  await typeInto(giulia, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'marco.deluca');
  await submitNear(giulia, 'form[data-enhance="delegation"] input[name="delegateHash"]');

  const paolo = await member(browser, 'paolo.greco');
  await visit(paolo, '/delegation');
  await typeInto(paolo, 'form[data-enhance="delegation"] input[name="topic"]', 'liste-attesa');
  await typeInto(paolo, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'giulia.ferrero');
  await submitNear(paolo, 'form[data-enhance="delegation"] input[name="delegateHash"]');
  await expectText(paolo, 'marco.deluca', 'the transitive chain resolves through to the end delegate');
  await shot(paolo, 'party-delegation', 'Liquid delegation you can read: paolo → giulia → marco on one topic, chosen by @handle and never by raw hash, with the “explain my influence” chain stating where the vote ends up.', {
    focus: '[data-composer-section="delegation-effective"]',
  });
}

/** A5/A6 — A ranked group election, won on transfers against the first-preference leader. */
async function journeyElection(browser) {
  console.log('\n— groups: a ranked election won on transfers');
  const irene = await member(browser, 'irene.fabbri');
  await visit(irene, '/groups');
  await typeInto(irene, 'input[name="name"]', 'Circolo Sanità Pubblica');
  await typeInto(irene, 'input[name="topics"]', 'liste-attesa,salario-minimo');
  await typeInto(irene, 'textarea[name="description"]', 'Delegati e priorità sui tempi di attesa e sul lavoro sanitario.');
  await submitNear(irene, 'input[name="name"]');
  const created = await expectText(irene, 'Circolo Sanità Pubblica', 'the group is created');
  if (!created) return;

  const groupId = await irene.evaluate(() => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="startElection"]'));
    return form?.querySelector('input[name="groupId"]')?.value || null;
  });
  if (!groupId) {
    record('could not read the new group id');
    return;
  }

  // Vote mode + prompt-on-conflict: the honest settings.
  await irene.evaluate((id) => {
    const form = [...document.querySelectorAll('form[action="/groups/policy"]')].find((f) => f.querySelector(`input[name="groupId"][value="${id}"]`));
    if (form) {
      form.closest('details')?.setAttribute('open', 'open');
      form.querySelector('select[name="electionMode"]').value = 'vote';
      form.querySelector('select[name="conflictRule"]').value = 'prompt_user';
      form.querySelector('button[type="submit"]').click();
    }
  }, groupId);
  await settle(irene);

  // Nine members join so the ballots below are cast by genuinely distinct sessions.
  const voters = ['marco.deluca', 'giulia.ferrero', 'valentina.sanna', 'tommaso.ricci', 'davide.villa', 'ahmed.ben.salah', 'luca.esposito', 'nadia.hamdi', 'anna.conti', 'paolo.greco'];
  for (const handle of voters) {
    const page = await member(browser, handle);
    await visit(page, '/groups');
    await page.evaluate((id) => {
      const form = [...document.querySelectorAll('form[action="/groups"]')].find(
        (f) => f.querySelector('input[name="action"][value="join"]') && f.querySelector(`input[name="groupId"][value="${id}"]`),
      );
      form?.querySelector('button[type="submit"]')?.click();
    }, groupId);
    await settle(page);
  }

  // irene starts the election by @handle (the controller resolves to hashes).
  await visit(irene, '/groups');
  await irene.evaluate((id) => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="startElection"]') && f.querySelector(`input[name="groupId"][value="${id}"]`));
    form?.closest('details')?.setAttribute('open', 'open');
    if (form) {
      form.querySelector('input[name="topic"]').value = 'liste-attesa';
      form.querySelector('input[name="candidates"]').value = 'giulia.ferrero, marco.deluca, valentina.sanna';
      form.querySelector('button[type="submit"]').click();
    }
  }, groupId);
  await settle(irene);

  // The canonical ballots: 4 marco, 3 giulia>valentina, 2 valentina>giulia.
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
    await visit(page, '/groups');
    await selectOptionByLabel(page, 'form select[name="candidateHash"]', first);
    if (second) await selectOptionByLabel(page, 'form select[name="secondChoiceHash"]', second);
    await page.evaluate(() => {
      const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="voteElection"]'));
      form?.querySelector('button[type="submit"]')?.click();
    });
    await settle(page);
  }

  // irene closes it and the winner surfaces on the card.
  await visit(irene, '/groups');
  await irene.evaluate(() => {
    const form = [...document.querySelectorAll('form[action="/groups"]')].find((f) => f.querySelector('input[name="action"][value="closeElection"]'));
    form?.querySelector('button[type="submit"]')?.click();
  });
  await settle(irene);
  await visit(irene, '/groups');
  await openDetails(irene, 'Delegate election');
  await expectText(irene, 'giulia.ferrero', 'the winner surfaces on the group card');
  await expectText(irene, 'rounds 2', 'the election was decided on a second-round transfer');
  await shot(irene, 'party-election', 'A ranked delegate election, won on transfers: the first-preference leader (the economist, most delegated weight in the party) loses to the frontline nurse once eliminated ballots transfer — method ranked, rounds 2.', {
    focus: '[data-composer-section="groups-list"]',
  });
}

/** Reads the id of the group card whose name matches, from any form that carries it. */
async function findGroupIdByName(page, name) {
  return page.evaluate((want) => {
    const cards = [...document.querySelectorAll('article')];
    const card = cards.find((c) => (c.querySelector('h3')?.textContent || '').toLowerCase().includes(want.toLowerCase()));
    return card?.querySelector('input[name="groupId"]')?.value || null;
  }, name);
}

async function joinGroup(page, groupId) {
  await visit(page, '/groups');
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
  await visit(page, '/groups');
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
 * A9 — Structure that grows a branch. A party circle gains a topic-focused think tank
 * beneath it, both declare the categories they work on, and the directory turns that into
 * an answer to "who do I delegate this to?" — the question topic-scoped delegation asks of
 * every member and, before this, left them to answer alone.
 */
async function journeyBranchGroups(browser) {
  console.log('\n— branches: a think tank inside the party, and a category directory');
  const irene = await member(browser, 'irene.fabbri');
  await visit(irene, '/groups');

  const parentId = await findGroupIdByName(irene, 'Circolo Sanità Pubblica');
  if (!parentId) {
    record('the parent circle from the election journey is missing');
    return null;
  }

  // The parent declares the broad categories it covers.
  await irene.evaluate((id) => {
    const form = [...document.querySelectorAll('form[action="/groups/topics"]')].find((f) =>
      f.querySelector(`input[name="groupId"][value="${id}"]`),
    );
    if (form) {
      form.closest('details')?.setAttribute('open', 'open');
      form.querySelector('input[name="topics"]').value = 'Sanità, Lavoro';
      form.querySelector('button[type="submit"]').click();
    }
  }, parentId);
  await settle(irene);

  // The branch: narrower, with its own subcategory and its own membership.
  await visit(irene, '/groups');
  await typeInto(irene, 'form[data-enhance="groups"] input[name="name"]', 'Officina Liste d’Attesa');
  await typeInto(irene, 'form[data-enhance="groups"] input[name="topics"]', 'Sanità / Liste di attesa');
  await selectOptionByLabel(irene, 'form[data-enhance="groups"] select[name="parentId"]', 'Circolo Sanità Pubblica');
  await typeInto(
    irene,
    'form[data-enhance="groups"] textarea[name="description"]',
    'Ramo tematico del Circolo: lavora solo sui tempi di attesa e sull’intramoenia.',
  );
  await submitNear(irene, 'form[data-enhance="groups"] input[name="name"]');

  await visit(irene, '/groups');
  const branchId = await findGroupIdByName(irene, 'Officina Liste');
  if (!branchId) {
    record('the branch group was not created');
    return null;
  }
  await expectText(irene, 'Branch of Circolo Sanità Pubblica', 'the branch shows its lineage, not just a name');
  await expectText(irene, 'Branches: Officina', 'the parent lists its branches');

  // The branch puts the elected nurse forward on its own subcategory.
  await visit(irene, '/groups');
  await irene.evaluate((id) => {
    const form = [...document.querySelectorAll('form[action="/groups/delegate"]')].find((f) =>
      f.querySelector(`input[name="groupId"][value="${id}"]`),
    );
    if (form) {
      form.closest('details')?.setAttribute('open', 'open');
      form.querySelector('input[name="topic"]').value = 'Sanità / Liste di attesa';
      form.querySelector('input[name="delegateHash"]').value = 'giulia.ferrero';
      form.querySelector('input[name="priority"]').value = '1';
      form.querySelector('button[type="submit"]').click();
    }
  }, branchId);
  await settle(irene);

  await visit(irene, '/groups');
  await shot(
    irene,
    'party-branch-groups',
    'Structure grows a branch: a topic-focused think tank sits under the party circle, indented and labelled “Branch of”. Nesting is structural, not authority — the branch keeps its own membership and its own delegate cachets.',
    { focus: '[data-composer-section="groups-list"]' },
  );

  await expectText(irene, 'Sanità / Liste di attesa', 'the branch subcategory reaches the directory');
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
  await visit(irene, '/groups');
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

  // A working note that belongs to the branch, not yet to the party.
  const nadia = await member(browser, 'nadia.hamdi');
  await visit(nadia, `/discussion?group=${branchId}`);
  await typeInto(nadia, '#discussion-compose input[name="topic"]', 'Sanità / Liste di attesa');
  await selectOptionByLabel(nadia, '#discussion-compose select[name="groupId"]', 'Officina Liste');
  await selectOption(nadia, '#discussion-compose select[name="stance"]', 'proposal');
  await typeInto(
    nadia,
    '#discussion-compose textarea[name="content"]',
    'Nota di lavoro del ramo: sui codici B il CUP di Palermo sfora del 41%. Prima di portarlo al Circolo verifichiamo i dati di altre tre ASP.',
  );
  await submitNear(nadia, '#discussion-compose textarea[name="content"]');

  await visit(nadia, `/discussion?group=${branchId}`);
  await expectText(nadia, 'Nota di lavoro del ramo', 'the branch lane carries the working note');
  await shot(
    nadia,
    'party-group-lane',
    'An optional internal lane: the branch works in its own discussion, members-only and off by default. Notes here stay out of the party-wide feed until someone moves them up — so a working draft is not a public position.',
    { focus: '[data-composer-section="discussion-feed"]' },
  );

  // A note posted in a branch lane must not leak into the Circle-wide feed.
  await visit(nadia, '/discussion');
  const leaked = (await pageText(nadia)).toLowerCase().includes('nota di lavoro del ramo');
  if (leaked) record('a branch-lane note leaked into the Circle-wide discussion feed');
  else ok('the branch note stays out of the Circle-wide feed');

  // tommaso is a plain member: he can ask, not decide.
  const tommaso = await member(browser, 'tommaso.ricci');
  await visit(tommaso, `/discussion?group=${branchId}`);
  await typeInto(
    tommaso,
    'form[data-enhance="promotion-request"] input[name="note"]',
    'I dati reggono: questa riguarda tutto il Circolo, non solo il ramo.',
  );
  await submitNear(tommaso, 'form[data-enhance="promotion-request"] input[name="note"]');
  await visit(tommaso, `/discussion?group=${branchId}`);
  await expectText(tommaso, 'asked for this to move up', 'the request is visible to the whole branch, not a private ping');

  // sofia — lane moderator, not admin — decides.
  const sofia = await member(browser, 'sofia.bianchi');
  await visit(sofia, `/discussion?group=${branchId}`);
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
  const moderatorCanRead = (await pageText(sofia)).toLowerCase().includes('nota di lavoro del ramo');
  if (moderatorCanRead) record('a branch moderator can read the parent circle’s members-only lane');
  else ok('the parent circle’s lane stays closed to a non-member, even a branch moderator');

  // Then read the result as someone who is actually in the parent circle.
  await visit(irene, `/discussion?group=${parentId}`);
  await expectText(irene, 'Nota di lavoro del ramo', 'the approved note now sits in the parent circle’s lane');
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
  await typeInto(davide, 'form[data-enhance="delegation"] input[name="topic"]', 'Sanità');
  await typeInto(davide, 'form[data-enhance="delegation"] input[name="delegateHash"]', 'giulia.ferrero');
  await submitNear(davide, 'form[data-enhance="delegation"] input[name="delegateHash"]');

  // A proposal whose category the author chooses — narrower than the delegation above.
  const nadia = await member(browser, 'nadia.hamdi');
  await visit(nadia, '/petitions');
  await typeInto(nadia, '#petitions-compose input[name="title"]', 'Tetto ai tempi CUP per i codici B nelle ASP siciliane');
  await typeInto(nadia, '#petitions-compose input[name="topic"]', 'Sanità / Liste di attesa');
  await typeInto(nadia, '#petitions-compose input[name="quorum"]', '1');
  await typeInto(
    nadia,
    '#petitions-compose textarea[name="summary"]',
    'Applicare il tetto PNGLA di 10 giorni ai codici B con pubblicazione mensile degli scostamenti per ogni ASP.',
  );
  await submitNear(nadia, '#petitions-compose input[name="title"]');
  await expectText(nadia, 'Sanità / Liste di attesa', 'the proposal keeps the category its author chose');

  const petitionId = await findPetitionId(nadia, 'codici B');
  if (!petitionId) {
    record('could not locate the subcategory proposal');
    return;
  }
  await signPetition(nadia, 'codici B');

  // The party secretary freezes and opens it.
  const elena = await member(browser, 'elena.rossi');
  await visit(elena, '/petitions');
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
  await visit(davide, '/petitions');
  await selectOption(davide, `#petition-${petitionId} form[action="/petitions/vote"] select[name="choice"]`, 'auto');
  await davide.evaluate((id) => {
    const form = document.querySelector(`#petition-${id} form[action="/petitions/vote"]`);
    form?.querySelector('button[type="submit"], button:not([type])')?.click();
  }, petitionId);
  await settle(davide);

  await visit(davide, '/petitions');
  await expectText(davide, 'giulia.ferrero', 'the delegation on the parent category reaches the subcategory proposal');
  await expectText(davide, 'awaiting delegates', 'an open delegated ballot is reported apart from the abstentions');
  await shot(
    davide,
    'party-delegated-ballot',
    'A delegated vote is a real ballot, not an abstention: davide delegated the broad category “Sanità”, and it reaches a proposal filed under “Sanità / Liste di attesa”. Until @giulia.ferrero votes it is counted as nothing — shown as “awaiting delegates”, never folded into the abstentions — and he can override it himself at any time.',
    { focus: `#petition-${petitionId}` },
  );

  // The other side of the contract: the delegate can see what is riding on her.
  const giulia = await member(browser, 'giulia.ferrero');
  await visit(giulia, '/delegation');
  await expectText(giulia, 'codici B', 'the delegate sees the ballot handed to her');
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
    const rows = [...document.querySelectorAll('.list-row')];
    const row = rows.find((r) => (r.textContent || '').toLowerCase().includes('marco.deluca'));
    return row?.querySelector('a[href^="/delegates/"]')?.getAttribute('href') || null;
  });
  if (href) {
    await visit(marco, href);
    await expectText(marco, 'Delegations received', 'the delegate profile is the soft-power accountability dashboard');
    await shot(marco, 'party-delegate-profile', 'Soft-power accountability, not compulsion: a delegate’s public dashboard — delegations received and set, vote history, group endorsements, and an advisory (never binding) deliberation score.', {
      focus: 'main',
    });
  } else {
    record('no profile link for @marco.deluca in the People directory');
  }
}

/**
 * A2.7/A2.13/A2.14 — the social lane stays social. Short attributed updates,
 * typed follow edges, and a reshare-with-comment, so the "small talk + info"
 * lane is populated and a screenshot can show at a glance that a social post is
 * not a vote. The feed is scoped to followed handles, so one member (Anna, the
 * high-activity student) follows the active posters and we shoot *her* wall.
 */
async function journeySocial(browser) {
  console.log('\n— social: the lane stays social (posts, typed follows, a reshare)');
  const posts = [
    ['anna.conti', 'Serata referendum ai banchetti: affluenza bassa ma tanti under-30 che chiedevano dello ius scholae. Il tema c’è, manca la legge.'],
    ['giulia.ferrero', 'Reparto pieno anche oggi. La proposta sull’intramoenia è però in dirittura: se avete firme da raccogliere in circolo, è il momento.'],
    ['valentina.sanna', 'Nota per chi mi chiede i numeri liste d’attesa: la fonte è la rilevazione interna su 14 aziende, non i portali regionali. Confronto la settimana prossima.'],
    ['tommaso.ricci', 'Da Trento: incontro di circolo giovedì sull’autonomia. Porto i dati sui LEP, non gli slogan.'],
    ['nadia.hamdi', 'Dalla Sicilia: stessi tempi CUP che si raccontano al Nord. Non è un’emergenza locale, è il sistema.'],
    ['ahmed.ben.salah', 'Turno finito. Grazie a chi è passato al presidio stamattina, eravamo in tanti.'],
    ['paolo.greco', 'Verificato allo sportello del circolo, con l’aiuto dei ragazzi. Ci sono anch’io.'],
    ['anna.conti', 'Promemoria: assemblea sullo ius scholae mercoledì, anche da remoto. Portate domande, non bandiere.'],
    ['valentina.sanna', 'Grafico dei tempi PNGLA per classe di priorità in arrivo. Chi lo vuole in anteprima, mi segua su “interesse”.'],
    ['luca.esposito', 'Non sono d’accordo su tutto, ma il livello del dibattito qui è un’altra cosa rispetto ai gruppi social. Si discute davvero.'],
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
  ];
  for (const [handle, type] of follows) {
    await follow(anna, { handle, type });
  }

  // A2.14 — a reshare with commentary (best-effort: the reshare form lives in a
  // per-post disclosure on the wall; if it is not reachable, the run continues).
  await visit(anna, '/social/feed');
  await anna.evaluate(() => {
    const cards = [...document.querySelectorAll('.social-post')];
    const card = cards.find((c) => (c.textContent || '').includes('tempi PNGLA per classe'));
    const details = card && [...card.querySelectorAll('details')].find((d) => /reshare/i.test(d.querySelector('summary')?.textContent || ''));
    if (!details) return;
    details.open = true;
    const form = details.querySelector('form');
    const ta = form?.querySelector('textarea[name="content"]');
    if (ta) ta.value = 'Da leggere prima di parlare di “vincolo di mandato” al bar.';
    const btn = form?.querySelector('button[type="submit"], button:not([type])');
    if (btn) btn.click();
  });
  await settle(anna);

  await visit(anna, '/social/feed');
  await expectText(anna, 'ius scholae', 'the social lane is populated and scoped to followed people');
  await shot(anna, 'party-social', 'The social lane stays social: short attributed updates from followed people, typed follows (circle/interest/info/alerts), and a reshare — visibly not a vote.', {
    focus: '#social-wall',
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
