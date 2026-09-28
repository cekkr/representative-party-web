#!/usr/bin/env node
/**
 * seed-demo
 * ---------
 * Fills a running deployment with a compact slice of Scenario A — Rete Civica Nazionale,
 * the fictional Italian civic party of principle-docs/SimulationScenarios.md — so the UI
 * can be reviewed (and screenshotted with ui-screenshots.js) against real political
 * content instead of empty states. In-app copy is English; people, laws and institutions
 * stay Italian, as the scenario specifies.
 *
 * This is a seed, not a replay: it posts forms directly and asserts nothing. For the
 * causal, asserted walkthrough (and the README captures) run scripts/party-journeys.js.
 *
 *   ENFORCE_CIRCLE=true CIRCLE_POLICY_ID=rete-civica-nazionale \
 *     DATA_VALIDATION_LEVEL=strict DATA_PREVIEW=false ./run-standalone.sh    # terminal 1
 *   BASE_URL=http://127.0.0.1:3000 ADMIN_SESSION=admin node scripts/seed-demo.js
 *
 * Safe to re-run: it appends, so use a fresh store for a clean set.
 */
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN_SESSION = process.env.ADMIN_SESSION || 'admin';

const MEMBERS = [
  { pid: 'seed-giulia', handle: 'giulia.ferrero', role: 'person' }, // nurse, Torino
  { pid: 'seed-marco', handle: 'marco.deluca', role: 'delegate' }, // health economist
  { pid: 'seed-sofia', handle: 'sofia.bianchi', role: 'delegate' }, // constitutional lawyer
  { pid: 'seed-luca', handle: 'luca.esposito', role: 'person' }, // restaurant owner
  { pid: 'seed-ahmed', handle: 'ahmed.ben.salah', role: 'person' }, // warehouse worker
  { pid: 'seed-valentina', handle: 'valentina.sanna', role: 'person' }, // researcher
  { pid: 'seed-elena', handle: 'elena.rossi', role: 'moderator' }, // party secretary
  { pid: 'seed-paolo', handle: 'paolo.greco', role: 'person' }, // retired teacher
];

const TOPIC = {
  waitingLists: 'Healthcare / Waiting lists',
  minimumWage: 'Labour / Minimum wage',
};

async function form(path, data, { cookie } = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) body.append(key, String(value));
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body, redirect: 'manual' });
  if (response.status >= 400) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${path} -> ${response.status} ${text.slice(0, 160)}`);
  }
  return response;
}

async function createMember({ pid, handle, role }) {
  const page = await fetch(`${BASE_URL}/auth/eudi`).then((r) => r.text());
  const match = page.match(/\/auth\/callback\?session=([^&"]+)&pidHash=([^"&]+)/);
  if (!match) throw new Error('could not parse the auth offer');
  const sessionId = match[1];
  const response = await fetch(`${BASE_URL}/auth/callback?session=${sessionId}&pidHash=${encodeURIComponent(pid)}`);
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error(`no session cookie for ${handle}`);

  await form('/admin', { intent: 'session', sessionId, sessionRole: role, sessionHandle: handle }, { cookie: adminCookie });
  return { pid, handle, role, sessionId, cookie };
}

const adminCookie = `circle_session=${ADMIN_SESSION}`;

/** run-standalone.sh seeds the admin session as pending; verify it before use. */
async function activateAdminSession() {
  const password = process.env.ADMIN_PASSWORD || 'admin';
  await fetch(
    `${BASE_URL}/auth/callback?session=${encodeURIComponent(ADMIN_SESSION)}&pidHash=${encodeURIComponent(password)}`,
  );
  const probe = await fetch(`${BASE_URL}/admin`, { headers: { Cookie: adminCookie } });
  if (probe.status !== 200) {
    throw new Error(`admin session "${ADMIN_SESSION}" is not usable (GET /admin -> ${probe.status})`);
  }
}

async function run() {
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health || !health.ok) throw new Error(`no deployment reachable at ${BASE_URL}`);
  await activateAdminSession();

  const people = {};
  for (const member of MEMBERS) {
    people[member.handle] = await createMember(member);
    console.log(`member  @${member.handle} (${member.role})`);
  }

  // --- Discussion: conversation before any vote (A2.1–A2.4, A2.6).
  const discussions = [
    ['giulia.ferrero', TOPIC.waitingLists, 'concern', 'In my department, the first available non-urgent cardiology appointment is 14 months away. Patients who can afford it use intramoenia and are seen within two weeks. Same building, same doctors, same day.'],
    ['marco.deluca', TOPIC.waitingLists, 'support', 'The CUP data I aggregated across three regions confirm it: for priority classes D and P, exceeding PNGLA waiting times is the rule, not the exception. This is not a local anomaly; it is an economic equilibrium.'],
    ['valentina.sanna', TOPIC.waitingLists, 'neutral', 'Is the 14-month figure a median or a worst case? That changes everything. Before we build a proposal on it, we need the distribution, not an anecdote.'],
    ['luca.esposito', TOPIC.minimumWage, 'concern', "Nine euros gross per hour for a restaurant with four seasonal employees means either raising prices by 12% or closing in November. I am not against a minimum wage; I am against doing it without looking at hospitality's real margins."],
    ['ahmed.ben.salah', TOPIC.minimumWage, 'support', 'At my warehouse, the pirate contract pays €6.40 an hour. That is not competition on margins; it is competition over who will accept less.'],
  ];
  for (const [handle, topic, stance, content] of discussions) {
    await form('/discussion', { topic, stance, content }, { cookie: people[handle].cookie });
  }
  console.log(`discuss ${discussions.length} notes`);

  // --- Forum: the free-mandate argument (A2.8).
  await form('/forum', {
    title: 'Why software cannot engineer around the free-mandate rule',
    content:
      'Article 67 of the Constitution says every member of Parliament represents the Nation and serves without a binding mandate. '
      + 'No platform can change that, and none should try. What software can do is make the record impossible to rewrite — '
      + 'who proposed what, how the text changed, how the members voted, and how the representative voted afterwards. '
      + 'That is soft power, and it is the only constitutional path open to us.',
  }, { cookie: people['sofia.bianchi'].cookie });
  console.log('forum   1 article');

  // --- Social lane: small talk, deliberately non-binding.
  const posts = [
    ['giulia.ferrero', 'Ward full again today. The intramoenia proposal is almost ready — if your circle still has signatures to collect, now is the time.'],
    ['valentina.sanna', 'For everyone asking where the waiting-list numbers come from: the internal survey of 14 health authorities, not the regional portals.'],
    ['paolo.greco', 'Verified at the circle office, with some help from the young ones. Count me in.'],
    ['luca.esposito', 'I do not agree with everything here, but the level of debate is something else compared with the usual social groups.'],
  ];
  for (const [handle, content] of posts) {
    await form('/social/post', { content }, { cookie: people[handle].cookie });
  }
  // The feed only shows people you follow, so the operator account follows the members
  // too — otherwise the seeded deployment still looks empty when reviewed as admin.
  const adminFollows = [['giulia.ferrero', 'circle'], ['valentina.sanna', 'interest'], ['paolo.greco', 'circle'], ['luca.esposito', 'info']];
  for (const [handle, type] of adminFollows) {
    await form('/social/follow', { handle, type }, { cookie: adminCookie });
  }
  console.log(`social  ${posts.length} posts, ${adminFollows.length} follows`);

  // --- A proposal mid-deliberation (A3.1, A3.3, A3.4–A3.6).
  await form('/petitions', {
    title: 'Conditional intramoenia: an ALPI cap wherever PNGLA windows are missed',
    topic: TOPIC.waitingLists,
    quorum: '4',
    summary: 'In specialties where public-service waiting times exceed PNGLA priority classes, intramoenia activity in the same specialty falls to 15% of public-service volumes until those times return to compliance.',
    problem: 'Law 120/2007 already prohibits ALPI from exceeding public-service volumes, but the constraint is aggregated and weakly checked. This is not a waiting list; it is a pricing mechanism.',
    proposedAction: "A 15% cap per specialty, tied to the national platform's monitoring (Law 107/2024), with automatic suspension once waiting times return to the U/B/D/P priority classes.",
    impact: 'Patients without the means to pay regain access within statutory time limits.',
    risks: 'Specialists may leave for the fully private sector; the cap must be paired with incentives for public-service activity.',
    implementationPlan: 'Measure at three months; trial the cap in two pilot health authorities at six months; review at twelve.',
    evidenceSummary: 'RCN survey of 14 health authorities (March 2026); Laws 120/2007 and 107/2024.',
  }, { cookie: people['giulia.ferrero'].cookie });

  const petitionsPage = await fetch(`${BASE_URL}/petitions`, { headers: { Cookie: adminCookie } }).then((r) => r.text());
  const petitionId = (petitionsPage.match(/id="petition-([^"]+)"/) || [])[1];
  if (!petitionId) throw new Error('could not find the seeded proposal');

  for (const handle of ['giulia.ferrero', 'marco.deluca', 'valentina.sanna', 'ahmed.ben.salah']) {
    await form('/petitions/sign', { petitionId }, { cookie: people[handle].cookie });
  }
  const notes = [
    ['luca.esposito', 'concern', 'If the cap bites, specialists will move to accredited private providers and public-service waits will worsen. What concretely offsets it?'],
    ['sofia.bianchi', 'concern', 'Healthcare organization is a regional competence under Title V: a national cap by specialty risks a conflict of competences.'],
    ['valentina.sanna', 'question', 'The survey covers 14 health authorities out of more than 100: is that a sufficient sample for a national cap?'],
  ];
  for (const [handle, stance, content] of notes) {
    await form('/petitions/comment', { petitionId, stance, content }, { cookie: people[handle].cookie });
  }
  console.log(`propose 1 proposal, 4 signatures, ${notes.length} notes`);

  // --- Delegation: topic-scoped, transitive, revocable (A6.2/A6.3).
  const delegations = [
    ['giulia.ferrero', 'marco.deluca', TOPIC.waitingLists],
    ['paolo.greco', 'giulia.ferrero', TOPIC.waitingLists],
    ['ahmed.ben.salah', 'sofia.bianchi', 'Institutions'],
  ];
  for (const [from, to, topic] of delegations) {
    await form('/delegation', { topic, delegateHash: to }, { cookie: people[from].cookie });
  }
  console.log(`delegate ${delegations.length} edges`);

  // --- A group that publishes an advisory cachet.
  await form('/groups', {
    action: 'create',
    name: 'Public Healthcare Circle',
    topics: `${TOPIC.waitingLists}, ${TOPIC.minimumWage}`,
    description: 'Delegates and priorities on waiting times and healthcare work. Advisory only; it holds no decision rights.',
  }, { cookie: people['marco.deluca'].cookie });
  console.log('groups  1 group');

  console.log('\nSeeded. Capture with: BASE_URL=%s node scripts/ui-screenshots.js', BASE_URL);
}

run().catch((error) => {
  console.error(`seed failed: ${error.message}`);
  process.exitCode = 1;
});
