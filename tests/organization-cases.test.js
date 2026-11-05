import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVerifiedSession } from './helpers/auth.js';
import { postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

const SOURCE_TEXT = 'At 03:40 we have 11 patients waiting for a bed, four for more than 24 hours, including two people over eighty.';

test('Scenario B discussion promotion is private, preserves the source, and records a durable acknowledgement', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'organization-cases-'));
  const kvFile = join(dir, 'store.json');
  // Exercise an upgrade from a store with group and preview content but no case key.
  await writeFile(kvFile, JSON.stringify({
    meta: { schemaVersion: 25, migrations: [] },
    discussions: [
      { id: 'restricted', groupId: 'medicina-urgenza', content: 'Emergency Medicine lane', authorHash: 'marino' },
      { id: 'preview', validationStatus: 'preview', content: 'Unvalidated boarding report', authorHash: 'calabrese' },
      { id: 'anonymous', content: 'Unattributed boarding report', authorHash: 'anonymous' },
    ],
  }));
  const port = await getAvailablePort();
  const options = { port, kvFile, dataAdapter: 'kv', allowPreviews: true, extraEnv: { ENFORCE_CIRCLE: 'false' } };
  let server = await startServer(options);
  t.after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });
  const store = async () => JSON.parse(await readFile(kvFile, 'utf8'));
  assert.equal(Object.hasOwn(await store(), 'organizationCases'), false);

  const { baseUrl } = server;
  const workspace = baseUrl + '/organization';
  const discussion = baseUrl + '/discussion';
  const admin = baseUrl + '/admin';
  const calabrese = await createVerifiedSession(baseUrl, { pidHash: 'n-calabrese' });
  const ferrara = await createVerifiedSession(baseUrl, { pidHash: 'r-ferrara' });
  const operator = await createVerifiedSession(baseUrl, { pidHash: 'asl-provider' });
  assert.equal((await postForm(admin, { intent: 'session', sessionId: operator.sessionId, sessionRole: 'admin' })).status, 200);
  assert.equal((await postForm(admin, { intent: 'modules', module_coordination: 'on' }, operator)).status, 200);
  assert.equal((await postForm(baseUrl + '/profile', { intent: 'handle', handle: 'n.calabrese' }, calabrese)).status, 200);
  assert.equal((await postForm(baseUrl + '/profile', { intent: 'handle', handle: 'r.ferrara' }, ferrara)).status, 200);
  const evidence = 'https://example.org/asl-val-sereno/admissions-flow';
  const posted = await postForm(discussion, {
    content: SOURCE_TEXT, stance: 'concern', topic: 'Emergency Department / Admissions', evidenceLinks: evidence,
  }, calabrese);
  assert.equal(posted.status, 200);
  const source = (await store()).discussions[0];
  const discussionHtml = await fetch(discussion, { headers: { Cookie: ferrara.cookie } }).then((res) => res.text());
  assert.ok(discussionHtml.includes(`/organization?source=${source.id}`));
  assert.doesNotMatch(discussionHtml, /organization\?source=(preview|anonymous|restricted)/);

  const promote = {
    intent: 'promote',
    sourceId: source.id,
    summary: 'Weekend boarding in the Emergency Department',
    voiceType: 'need',
    consequence: 'Triage staff must reassess patients while they wait for admission.',
  };
  assert.equal((await postForm(workspace, promote)).status, 401);
  for (const sourceId of ['preview', 'anonymous', 'restricted', 'unknown']) {
    const denied = await postForm(workspace, { ...promote, sourceId }, ferrara);
    assert.equal(denied.status, 404);
    assert.doesNotMatch(await denied.text(), /Emergency Medicine lane|Unvalidated boarding report|Unattributed boarding report/);
  }
  assert.equal((await postForm(workspace, { ...promote, voiceType: 'protected' }, ferrara)).status, 400);
  const form = await fetch(`${workspace}?source=${source.id}`, { headers: { Cookie: ferrara.cookie } });
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Case summary/);
  assert.equal(Object.hasOwn(await store(), 'organizationCases'), false);

  const [opened, retry] = await Promise.all([
    postForm(workspace, promote, ferrara),
    postForm(workspace, promote, ferrara),
  ]);
  assert.equal(opened.status, 200);
  assert.equal(opened.url, retry.url);
  const caseId = new URL(opened.url).searchParams.get('case');
  assert.ok(caseId);
  const openedHtml = await opened.text();
  assert.match(openedHtml, /Awaiting acknowledgement/);
  assert.ok(openedHtml.includes(SOURCE_TEXT));
  assert.ok(openedHtml.includes(evidence));
  assert.match(openedHtml, /@n\.calabrese/);

  const acknowledgement = {
    intent: 'acknowledge', caseId, reviewAt: '2027-01-18', note: 'Received. The admissions-flow group will review the weekend evidence.',
  };
  assert.equal((await postForm(workspace, { ...acknowledgement, reviewAt: '2027-02-31' }, ferrara)).status, 400);
  assert.equal((await postForm(workspace, acknowledgement, ferrara)).status, 200);
  assert.equal((await postForm(workspace, { ...acknowledgement, note: 'Replace the acknowledgement' }, calabrese)).status, 200);

  const beforeRestart = await store();
  assert.equal(beforeRestart.organizationCases.length, 1);
  assert.deepEqual(beforeRestart.discussions.find((entry) => entry.id === source.id), source);
  assert.equal(beforeRestart.organizationCases[0].sourceMessageId, source.id);
  assert.equal(beforeRestart.organizationCases[0].acknowledgement.note, acknowledgement.note);
  assert.doesNotMatch(JSON.stringify(beforeRestart.organizationCases), /At 03:40/);
  const audit = beforeRestart.transactions.filter((entry) => entry.type.startsWith('organization_case_'));
  assert.deepEqual(audit.map((entry) => entry.type), ['organization_case_acknowledged', 'organization_case_opened']);
  assert.ok(audit.every((entry) => entry.providerLocal));
  for (const route of ['/health', '/transactions', '/transactions/export']) {
    assert.doesNotMatch(await fetch(baseUrl + route).then((res) => res.text()), /organization_case_/);
  }
  assert.doesNotMatch(await fetch(opened.url).then((res) => res.text()), /Weekend boarding|admissions-flow group/);

  await server.stop();
  server = await startServer(options);
  const headers = { Cookie: ferrara.cookie, 'X-Requested-With': 'partial' };
  const restored = await fetch(opened.url, { headers });
  assert.equal(restored.headers.get('cache-control'), 'private, no-store');
  const restoredHtml = await restored.text();
  assert.doesNotMatch(restoredHtml, /<!doctype html>/i);
  assert.match(restoredHtml, /Review on 18\/01\/2027/);
  assert.match(restoredHtml, /@r\.ferrara/);
  assert.ok(restoredHtml.includes(SOURCE_TEXT));
  assert.match(await fetch(`${workspace}?q=reassess`, { headers }).then((res) => res.text()), /Weekend boarding/);
  assert.match(await fetch(`${workspace}?q=oncology`, { headers }).then((res) => res.text()), /No cases match/);

  assert.equal((await postForm(admin, { intent: 'session', sessionId: ferrara.sessionId, sessionBanned: 'true' }, operator)).status, 200);
  assert.equal((await postForm(workspace, acknowledgement, ferrara)).status, 403);
  assert.equal((await postForm(admin, { intent: 'modules' }, operator)).status, 200);
  assert.equal((await fetch(opened.url, { headers })).status, 403);
  assert.equal((await postForm(workspace, promote, calabrese)).status, 403);
  assert.doesNotMatch(await fetch(discussion, { headers: { Cookie: calabrese.cookie } }).then((res) => res.text()), /organization\?case=/);
  assert.equal((await postForm(admin, { intent: 'modules', module_coordination: 'on' }, operator)).status, 200);
  assert.match(await fetch(opened.url, { headers: { Cookie: calabrese.cookie } }).then((res) => res.text()), /Review on 18\/01\/2027/);
});
