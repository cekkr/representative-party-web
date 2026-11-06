import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

const mainOf = (html) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] || html;
const section = (html, key) =>
  html.match(new RegExp(`<section\\b[^>]*data-composer-section="${key}"[^>]*>([\\s\\S]*?)</section>`))?.[1] || '';

test('Profile is an identity header with labelled settings sections and inline feedback', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  // A guest sees one heading and the verification path, not empty forms.
  const guest = mainOf((await fetchText(`${baseUrl}/profile`)).text);
  assert.equal(guest.match(/<h1\b/g)?.length, 1);
  assert.match(guest, /<h1[^>]*>Profile<\/h1>/);
  assert.match(guest, /<a class="cta" href="\/auth\/eudi" data-partial>Verify with your wallet<\/a>/);

  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero-profile-hash' });
  const saved = await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, giulia);
  assert.equal(saved.status, 200);
  const page = mainOf(await saved.text());
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /<h1[^>]*>@giulia\.ferrero<\/h1>/);
  assert.match(page, /<nav class="workspace-sections" aria-label="Profile settings">/);
  for (const [anchor, key] of [
    ['profile-handle', 'profile-interface'],
    ['profile-attributes', 'profile-summary'],
    ['profile-interface-defaults', 'profile-fields'],
  ]) {
    // Stable Sections keys stay on the same logical panels; the anchors are new.
    assert.match(page, new RegExp(`<a href="#${anchor}">`));
    assert.match(page, new RegExp(`id="${anchor}"[^>]*data-composer-section="${key}"`));
  }
  // Each form returns to its own section, so the confirmation lands in view.
  assert.match(section(page, 'profile-interface'), /action="\/profile#profile-handle"/);
  assert.match(section(page, 'profile-fields'), /action="\/profile#profile-interface-defaults"/);
  assert.match(section(page, 'profile-interface'), /<p class="form-notice" role="status">Handle updated to @giulia\.ferrero\.<\/p>/);
  // Natural dotted handles are allowed, and the hint says so.
  assert.match(section(page, 'profile-interface'), /or dots/);

  // The rail carries a short hash cue, never the raw blinded hash as identity.
  const rail = page.match(/<aside class="page-aside" aria-label="Session details">([\s\S]*?)<\/aside>/)?.[1] || '';
  assert.match(rail, /giulia-f…/);
  assert.doesNotMatch(rail, /giulia-ferrero-profile-hash/);
  assert.match(page, /href="\/delegates\/giulia-ferrero-profile-hash" data-partial>View your public profile/);

  // A rejected handle keeps the typed value and ties the error to the control.
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca-profile-hash' });
  const rejected = mainOf(await (await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, marco)).text());
  const handleSection = section(rejected, 'profile-interface');
  assert.match(handleSection, /<div class="callout is-warning form-errors" role="alert" id="profile-handle-error">/);
  assert.match(handleSection, /aria-describedby="profile-handle-hint profile-handle-error" aria-invalid="true"/);
  assert.match(handleSection, /value="giulia\.ferrero"/);

  const ui = mainOf(await (await postForm(`${baseUrl}/profile`, { intent: 'ui-preferences', uiLargeText: 'on' }, giulia)).text());
  assert.match(section(ui, 'profile-fields'), /role="status">[^<]*Interface defaults updated\./);
  assert.match(section(ui, 'profile-fields'), /<legend class="small">Comfort and navigation<\/legend>/);
});

test('Wallet handoff, result, and failure are focused task pages with recovery', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);

  const offer = mainOf((await fetchText(`${baseUrl}/auth/eudi`)).text);
  assert.equal(offer.match(/<h1\b/g)?.length, 1);
  assert.match(offer, /<h1[^>]*>Verify with your wallet<\/h1>/);
  assert.match(offer, /<ol class="task-steps">/);
  assert.match(offer, /<img src="[^"]+" alt="QR code[^"]*"/);
  assert.match(offer, /data-deep-link="[^"]+"/);
  assert.match(offer, /data-deep-link-fallback/);
  assert.match(offer, /Hash-only guarantee/);
  const sessionId = offer.match(/href="\/auth\/eudi\?session=([^"]+)" data-partial>Refresh this request/)?.[1];
  assert.ok(sessionId, 'the handoff offers to refresh the same pending session');
  assert.match(offer, /href="\/auth\/eudi" data-partial>Start a new request/);

  const failed = mainOf((await fetchText(`${baseUrl}/auth/callback?session=missing`)).text);
  assert.match(failed, /<h1[^>]*>We could not verify your wallet<\/h1>/);
  assert.match(failed, /<p role="alert">Missing or unknown session/);
  assert.match(failed, /<a class="cta" href="\/auth\/eudi" data-partial>Start a new verification<\/a>/);

  // Turning Social off removes it from the result page instead of linking to a 403.
  assert.equal((await postForm(`${baseUrl}/admin`, { intent: 'modules' })).status, 200);
  const done = await fetchText(`${baseUrl}/auth/callback?session=${encodeURIComponent(sessionId)}&pidHash=anna-conti-task`);
  const result = mainOf(done.text);
  assert.match(result, /<h1[^>]*>You are verified<\/h1>/);
  assert.match(result, /href="\/profile#profile-handle" data-partial>Choose your handle/);
  assert.match(result, /anna-con…/);
  assert.doesNotMatch(result, /href="\/social\/feed"/);
});

test('The organization preview keeps its preview identity outside optional panels', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, dataAdapter: 'memory' });
  t.after(stop);
  const html = mainOf((await fetchText(`${baseUrl}/organization?view=preview`)).text);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  const header = html.match(/<header class="workspace-heading preview-heading">([\s\S]*?)<\/header>/)?.[1] || '';
  assert.match(header, /Organization workspace preview/);
  assert.match(header, /nothing here is saved/);
  assert.match(header, /href="\/organization" data-partial>Open the live case queue/);
  assert.match(html, /href="\/organization" data-partial>Back to live cases/);
});

test('Admin is an indexed settings document whose notices land beside the submitted form', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, dataAdapter: 'memory' });
  t.after(stop);

  // First run: no admin exists, so /admin is open (and says so).
  const page = mainOf((await fetchText(`${baseUrl}/admin`)).text);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /<h1[^>]*>Provider administration<\/h1>/);
  assert.match(page, /data-admin-bootstrap/);
  const index = page.match(/<nav class="admin-index" aria-label="Admin settings">([\s\S]*?)<\/nav>/)?.[1] || '';
  const anchors = [...index.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  assert.equal(anchors.length, 20);
  for (const id of anchors) {
    assert.match(page, new RegExp(`<section class="panel settings-section" id="${id}" tabindex="-1" data-composer-section="${id}"`), id);
  }
  // Every admin form returns to its own section.
  assert.doesNotMatch(page, /action="\/admin"/);
  assert.match(section(page, 'rate-limits'), /action="\/admin#rate-limits"/);

  // A success renders only in the section that submitted it.
  const modules = mainOf(await (await postForm(`${baseUrl}/admin`, { intent: 'modules', social: 'on' })).text());
  assert.match(section(modules, 'modules'), /<p class="form-notice" role="status">Module toggles updated\./);
  assert.doesNotMatch(section(modules, 'circle-settings'), /form-notice/);

  // A rejection is a warning status plus an alert summary in the same section.
  const limits = mainOf(await (await postForm(`${baseUrl}/admin`, { intent: 'rate-limits', rateLimitOverrides: 'nonsense' })).text());
  const limitsSection = section(limits, 'rate-limits');
  assert.match(limitsSection, /<p class="form-notice is-warning" role="status">Rate limits not saved/);
  assert.match(limitsSection, /class="callout is-warning form-errors" role="alert"/);

  // "required for posting" is a success, not a refusal.
  const saved = mainOf(await (await postForm(`${baseUrl}/admin`, {
    intent: 'settings', requireVerification: 'on', circleName: 'Rete "Civica" <Nazionale>',
  })).text());
  assert.match(section(saved, 'circle-settings'), /<p class="form-notice" role="status">Settings saved/);
  // Operator and member text is escaped inside form values.
  assert.match(saved, /name="circleName" value="Rete &quot;Civica&quot; &lt;Nazionale&gt;"/);
  const echoed = mainOf(await (await postForm(`${baseUrl}/admin`, {
    intent: 'profile-attributes', attributesSessionId: 'missing', attributesPayload: '</textarea><script>alert(1)</script>',
  })).text());
  assert.doesNotMatch(echoed, /<script>alert\(1\)<\/script>/);
  assert.match(section(echoed, 'provider-profiles'), /form-notice is-warning" role="status">Session &quot;missing&quot; not found/);
});
