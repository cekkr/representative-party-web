#!/usr/bin/env node
/**
 * seed-demo
 * ---------
 * Fills a running deployment with a small, plausible organization so the UI can
 * be reviewed (and screenshotted) against real content instead of empty states.
 *
 * The scenario follows the adoption staircase in
 * principle-docs/OrganizationPressureManagement.md: a care cooperative that
 * starts from a shared inbox and has grown into proposals and delegation.
 *
 *   BASE_URL=http://127.0.0.1:3000 ADMIN_SESSION=admin node scripts/seed-demo.js
 *
 * Safe to re-run: it appends, so use a fresh store for a clean set.
 */
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN_SESSION = process.env.ADMIN_SESSION || 'admin';

const MEMBERS = [
  { pid: 'seed-nadia', handle: 'nadia', role: 'person', bio: 'Night nursing lead' },
  { pid: 'seed-tomas', handle: 'tomas', role: 'person', bio: 'Pharmacy coordination' },
  { pid: 'seed-ines', handle: 'ines', role: 'delegate', bio: 'Elected delegate, care quality' },
  { pid: 'seed-koen', handle: 'koen', role: 'person', bio: 'Logistics, evening rota' },
  { pid: 'seed-mara', handle: 'mara', role: 'moderator', bio: 'Works council moderator' },
];

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

  // --- Social lane: small talk and coordination, deliberately non-binding.
  const posts = [
    ['nadia', 'Third late pharmacy release this week. Logging it before the rota meeting so we have the pattern, not just the anecdote.'],
    ['tomas', 'Confirmed from our side: the 21:40 release depends on one porter run. If that slips, everything downstream slips.'],
    ['koen', 'Evening rota is short one porter on Tuesdays and Thursdays. That lines up with the delays Nadia flagged.'],
    ['ines', 'Collecting this into a proposal so it gets a decision path rather than another thread. Keeping the original messages attached.'],
    ['mara', 'Reminder: this lane stays conversational. Nothing here is a decision — the proposal track is where it counts.'],
  ];
  for (const [handle, content] of posts) {
    await form('/social/post', { content }, { cookie: people[handle].cookie });
  }
  console.log(`social  ${posts.length} posts`);

  const follows = [
    ['nadia', 'tomas', 'circle'], ['nadia', 'ines', 'info'], ['tomas', 'nadia', 'circle'],
    ['koen', 'nadia', 'alerts'], ['ines', 'nadia', 'circle'], ['ines', 'tomas', 'interest'],
    ['mara', 'ines', 'info'], ['koen', 'tomas', 'circle'],
  ];
  for (const [from, to, type] of follows) {
    await form('/social/follow', { handle: to, type }, { cookie: people[from].cookie });
  }
  // The feed only shows people you follow, so the operator account follows the
  // team too — otherwise the seeded deployment still looks empty when reviewed
  // or screenshotted as admin.
  const adminFollows = [['nadia', 'circle'], ['tomas', 'circle'], ['ines', 'info'], ['koen', 'alerts'], ['mara', 'info']];
  for (const [handle, type] of adminFollows) {
    await form('/social/follow', { handle, type }, { cookie: adminCookie });
  }
  console.log(`follows ${follows.length + adminFollows.length} edges`);

  // --- Discussion lane: deliberation with evidence.
  const discussions = [
    ['nadia', 'Night medication delivery keeps missing the safety window. Four times this month the ward received deliveries more than 30 minutes after pharmacy release. The checks still happened, but the available time was compressed.'],
    ['tomas', 'Pharmacy release timing, porter capacity, and ward hand-off need to be looked at together. Treating them separately is why this keeps recurring.'],
    ['koen', 'Proposing we measure across three shifts before changing the sequence, so we are not trading one bottleneck for another.'],
    ['ines', 'Agreed on measuring first. Adding the shift data to the proposal as evidence rather than asserting the cause.'],
  ];
  for (const [handle, content] of discussions) {
    await form('/discussion', { content }, { cookie: people[handle].cookie });
  }
  console.log(`discuss ${discussions.length} posts`);

  // --- Forum: long-form.
  await form('/forum', {
    title: 'Review: what the delivery-sequence pilot actually changed',
    content:
      'A bounded pilot ran for three weeks across the night rota. Median delay fell from 34 to 11 minutes. '
      + 'Recurrence checks matter more than the headline: two of the three wards report the pressure moved to the '
      + 'evening hand-off rather than disappearing. Closing a case is not the same as solving the problem, so the '
      + 'displacement check stays open for the next review window.',
  }, { cookie: people.ines.cookie });
  console.log('forum   1 article');

  // --- Governance: a proposal mid-deliberation with signatures and stance-tagged notes.
  await form('/petitions', {
    title: 'Validate the night delivery sequence before changing the rota',
    summary: 'Measure the pharmacy-release to ward-delivery sequence across three shifts, then run a bounded pilot with an explicit stop condition.',
    quorum: '3',
    problem: 'Night deliveries arrive after the safety window, compressing checks rather than removing them.',
    proposedAction: 'Instrument the current sequence for three shifts, then pilot a revised release order on one ward.',
    impact: 'Restores the intended check window without moving risk onto the ward team.',
    risks: 'The bottleneck may move to the evening hand-off; the pilot needs a displacement check and a stop condition.',
    implementationPlan: 'Weeks 1-3 measure. Week 4 review. Weeks 5-7 bounded pilot on one ward. Week 8 impact review.',
    evidenceSummary: 'Four logged late deliveries this month; porter capacity gaps on Tuesday and Thursday evenings.',
  }, { cookie: people.ines.cookie });

  const petitionsPage = await fetch(`${BASE_URL}/petitions`, { headers: { Cookie: adminCookie } }).then((r) => r.text());
  const petitionId = (petitionsPage.match(/id="petition-([^"]+)"/) || [])[1];
  if (!petitionId) throw new Error('could not find the seeded proposal');

  for (const handle of ['nadia', 'tomas', 'koen']) {
    await form('/petitions/sign', { petitionId }, { cookie: people[handle].cookie });
  }
  const notes = [
    ['nadia', 'support', 'Measuring before changing the sequence is the right order. The pattern is consistent across three wards.'],
    ['tomas', 'concern', 'Pharmacy cannot absorb an earlier release without a second porter run. That constraint needs to be visible in the plan.'],
    ['koen', 'question', 'Does the pilot include the evening hand-off, or only the night rota? The displacement risk sits at the boundary.'],
  ];
  for (const [handle, stance, content] of notes) {
    await form('/petitions/comment', { petitionId, stance, content }, { cookie: people[handle].cookie });
  }
  console.log(`propose 1 proposal, 3 signatures, ${notes.length} notes`);

  // --- Delegation: topic-scoped and revocable.
  const delegations = [
    ['nadia', 'ines', 'care-quality'],
    ['koen', 'ines', 'care-quality'],
    ['tomas', 'nadia', 'logistics'],
  ];
  for (const [from, to, topic] of delegations) {
    await form('/delegation', { topic, delegateHash: people[to].pid }, { cookie: people[from].cookie });
  }
  console.log(`delegate ${delegations.length} edges`);

  // --- A group that publishes an advisory cachet.
  await form('/groups', {
    action: 'create',
    name: 'Night rota working group',
    description: 'Temporary group coordinating the delivery-sequence review. Advisory only; it does not hold decision rights.',
  }, { cookie: people.mara.cookie });
  console.log('groups  1 group');

  console.log('\nSeeded. Capture with: BASE_URL=%s node scripts/ui-screenshots.js', BASE_URL);
}

run().catch((error) => {
  console.error(`seed failed: ${error.message}`);
  process.exitCode = 1;
});
