import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVerifiedSession } from './helpers/auth.js';
import { fetchText, postForm } from './helpers/http.js';
import { getAvailablePort, startServer } from './helpers/server.js';

const postIdFor = (html, text) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`id="social-post-([^"]+)"[\\s\\S]*?${escaped}`))?.[1];
};

test('a Social update has a focused view gated by its audience, linked from the wall and the inbox', async (t) => {
  const port = await getAvailablePort();
  const { baseUrl, stop } = await startServer({ port, extraEnv: { ENFORCE_CIRCLE: 'true' } });
  t.after(stop);
  const giulia = await createVerifiedSession(baseUrl, { pidHash: 'giulia-ferrero' });
  const marco = await createVerifiedSession(baseUrl, { pidHash: 'marco-deluca' });
  const outsider = await createVerifiedSession(baseUrl, { pidHash: 'valentina-sanna' });
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'giulia.ferrero' }, giulia);
  await postForm(`${baseUrl}/profile`, { intent: 'handle', handle: 'marco.deluca' }, marco);

  // A public update mentioning Marco, then Marco's reply.
  await postForm(`${baseUrl}/social/post`, {
    content: 'Banchetto in Piazza Pretoria on Saturday, @marco.deluca bring the waiting-list flyers.',
    visibility: 'public',
  }, giulia);
  const wall = (await fetchText(`${baseUrl}/social/feed`, { headers: { Cookie: giulia.cookie } })).text;
  const publicId = postIdFor(wall, 'Banchetto in Piazza Pretoria');
  assert.ok(publicId);
  const permalink = `/social/feed?post=${publicId}`;
  assert.match(wall, new RegExp(`class="topic-time muted small" href="${permalink.replace(/[?]/g, '\\?')}" data-partial`));

  const marcoInbox = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(marcoInbox, /You were mentioned/);
  assert.match(marcoInbox, new RegExp(`href="${permalink.replace(/[?]/g, '\\?')}" data-partial>Open update`));

  const reply = await postForm(`${baseUrl}/social/reply`, { replyTo: publicId, visibility: 'public', content: 'Flyers printed, 200 copies.' }, marco);
  assert.equal(reply.status, 200);
  assert.equal(reply.url, `${baseUrl}${permalink}#social-replies`.replace(/#.*$/, ''));

  for (const headers of [{}, { 'X-Requested-With': 'partial' }]) {
    const focused = await fetchText(`${baseUrl}${permalink}`, { headers });
    assert.equal(focused.response.status, 200);
    assert.match(focused.text, /<h1 tabindex="-1">Update from @giulia\.ferrero<\/h1>/);
    assert.match(focused.text, /href="\/social\/feed" data-partial>Back to Social feed/);
    assert.match(focused.text, /Replies <span class="muted small">\(1\)<\/span>/);
    assert.match(focused.text, /Flyers printed, 200 copies\./);
    // The reply points back at the opened update on the same page.
    assert.match(focused.text, new RegExp(`Reply to <a href="#social-post-${publicId}">@giulia\\.ferrero`));
  }
  const focusedReply = (await fetchText(`${baseUrl}/social/feed`, { headers: { Cookie: marco.cookie } })).text;
  const replyId = postIdFor(focusedReply, 'Flyers printed');
  const replyView = (await fetchText(`${baseUrl}/social/feed?post=${replyId}`)).text;
  assert.match(replyView, new RegExp(`In reply to <a href="/social/feed\\?post=${publicId}" data-partial>@giulia\\.ferrero`));

  // A direct message opens only for its two participants.
  await postForm(`${baseUrl}/social/post`, { content: 'Private: the ASP contact is Dr. Lo Iacono.', visibility: 'direct', targetHandle: 'marco.deluca' }, giulia);
  const giuliaWall = (await fetchText(`${baseUrl}/social/feed`, { headers: { Cookie: giulia.cookie } })).text;
  const directId = postIdFor(giuliaWall, 'Private: the ASP contact');
  assert.ok(directId);
  const directUrl = `${baseUrl}/social/feed?post=${directId}`;
  for (const session of [giulia, marco]) {
    const allowed = await fetchText(directUrl, { headers: { Cookie: session.cookie } });
    assert.equal(allowed.response.status, 200);
    assert.match(allowed.text, /Direct message from @giulia\.ferrero/);
  }
  for (const headers of [{}, { Cookie: outsider.cookie }, { Cookie: outsider.cookie, 'X-Requested-With': 'partial' }]) {
    const refused = await fetchText(directUrl, { headers });
    assert.equal(refused.response.status, 404);
    assert.match(refused.text, /Update unavailable/);
    assert.doesNotMatch(refused.text, /ASP contact/);
  }
  const dmInbox = (await fetchText(`${baseUrl}/notifications`, { headers: { Cookie: marco.cookie } })).text;
  assert.match(dmInbox, new RegExp(`href="/social/feed\\?post=${directId}" data-partial>Open conversation`));
});
