import { AsyncLocalStorage } from 'node:async_hooks';

import { FORM_OUTCOME, renderFlashNotice, setFlashNotice } from './formOutcome.js';

// Member write handlers refuse with a structured JSON status (`{ error, message }`),
// which integrations and tests rely on. An ordinary browser form that receives one
// used to show the member a raw JSON document. Routes marked `browserForm` instead
// turn that refusal into a redirect back to the page the form was on, with a fixed
// notice under its heading. Enhanced (partial) submissions keep the JSON, and
// app.js shows its message inside the form, so a typed draft is never thrown away.

const { NOT_APPLIED } = FORM_OUTCOME;

// The page-level notice scope. Module notices (groups, delegation, …) keep their own
// scopes and placements; this one is rendered by the shell under the page heading.
export const PAGE_NOTICE_SCOPE = 'page';

const refused = (message) => Object.freeze({ outcome: NOT_APPLIED, message });

// Fixed messages, chosen by code only. Every one says nothing changed, because a
// refusal never applies part of a write.
export const REFUSAL_NOTICES = Object.freeze({
  refused: refused('That was not saved. Nothing changed. Check the form and try again.'),
  'verification-required': refused('Verify your identity to do that. Nothing changed.'),
  'strict-requires-verification': refused('This Circle requires a verified person for that. Nothing changed.'),
  'open-circle-guest': refused('Sign in to take part. Nothing changed.'),
  banned: refused('This account is banned from taking part here. Nothing changed.'),
  'insufficient-privileges': refused('Your role cannot do that here. Nothing changed.'),
  'rate-limited': refused('You are posting faster than this Circle allows. Wait a moment, then use Back to recover your text and send it again.'),
  'module-disabled': refused('That part of the site is switched off on this provider. Nothing changed.'),
  'payload-too-large': refused('That submission is larger than this provider accepts. Nothing changed.'),
  'missing-fields': refused('Some required fields were empty. Nothing changed.'),
  'missing-content': refused('Write something before sending. Nothing changed.'),
  'not-found': refused('That record no longer exists or you can no longer open it. Nothing changed.'),
  'group-membership-required': refused('Join the group to take part in its lane. Nothing changed.'),
  'lane-disabled': refused('That group lane is closed. Nothing changed.'),
  'petition-closed': refused('This proposal is not open for that right now. Nothing changed.'),
  'petition-locked': refused('Draft editing is closed once voting opens. Nothing changed.'),
  'already-signed': refused('You have already signed this proposal.'),
  'delegate-outside-group-lane': refused('Your delegate cannot hold a ballot in this group lane. Vote yourself instead. Nothing changed.'),
  'vote-freeze-required': refused('Freeze the proposal text before opening the vote. Nothing changed.'),
  'invalid-status': refused('That stage change is not available. Nothing changed.'),
  'not-promotable': refused('That item cannot move up from here. Nothing changed.'),
  'already-top-level': refused('That item is already at the top level. Nothing changed.'),
  'no-open-request': refused('There is no open move request to decide. Nothing changed.'),
  'media-rejected': refused('That attachment was not accepted (type, size, or count). Nothing was posted.'),
  'audience-mismatch': refused('A reply keeps the audience of its conversation. Nothing was posted.'),
  'reshare-refused': refused('That update cannot be reshared. Nothing changed.'),
  'handle-not-found': refused('No member has that handle. Nothing changed.'),
  'invalid-target': refused('You cannot follow that account. Nothing changed.'),
});

// Error names from controllers, policy, and domain validators, folded into the
// catalog. Anything unlisted reads as the generic refusal rather than leaking a
// code name to the member.
const ERROR_CODES = {
  verification_required: 'verification-required',
  strict_requires_verification: 'strict-requires-verification',
  open_circle_guest: 'open-circle-guest',
  banned: 'banned',
  insufficient_privileges: 'insufficient-privileges',
  rate_limited: 'rate-limited',
  module_disabled: 'module-disabled',
  payload_too_large: 'payload-too-large',
  missing_fields: 'missing-fields',
  missing_content: 'missing-content',
  missing_target: 'missing-fields',
  missing_parent: 'not-found',
  not_found: 'not-found',
  entry_not_found: 'not-found',
  petition_not_found: 'not-found',
  thread_not_found: 'not-found',
  group_not_found: 'not-found',
  target_not_found: 'not-found',
  media_not_found: 'not-found',
  group_membership_required: 'group-membership-required',
  lane_disabled: 'lane-disabled',
  petition_closed: 'petition-closed',
  petition_locked: 'petition-locked',
  already_signed: 'already-signed',
  delegate_outside_group_lane: 'delegate-outside-group-lane',
  vote_freeze_required: 'vote-freeze-required',
  invalid_status: 'invalid-status',
  not_promotable: 'not-promotable',
  already_top_level: 'already-top-level',
  no_open_request: 'no-open-request',
  media_too_large: 'media-rejected',
  unsupported_media: 'media-rejected',
  missing_media: 'media-rejected',
  empty_media: 'media-rejected',
  too_many_media: 'media-rejected',
  filename_too_large: 'media-rejected',
  audience_mismatch: 'audience-mismatch',
  reshare_private: 'reshare-refused',
  reshare_blocked: 'reshare-refused',
  missing_reshare: 'reshare-refused',
  handle_not_found: 'handle-not-found',
  invalid_target: 'invalid-target',
};

export function refusalCode(error) {
  return ERROR_CODES[String(error || '')] || 'refused';
}

// A full-page navigation from an ordinary form: it asks for HTML and is not the
// enhanced fetch (which keeps the JSON so the form can show it in place).
export function isBrowserNavigation(req) {
  if (req?.headers?.['x-requested-with'] === 'partial') return false;
  return String(req?.headers?.accept || '').toLowerCase().includes('text/html');
}

// Where to return: the same-origin page the form was on, path and query only, so a
// forged Referer cannot turn the redirect into an open one.
export function resolveReturnHref(req, fallback = '/') {
  const referer = String(req?.headers?.referer || '');
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    if (url.host !== req.headers.host) return fallback;
    const path = `${url.pathname}${url.search}`;
    return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
  } catch {
    return fallback;
  }
}

// Wraps the response so a 4xx JSON refusal becomes a 303 to the referring page with
// a page notice. Successes, redirects, HTML, and 5xx pass through untouched.
export function captureBrowserFormRefusals(req, res, { fallback = '/' } = {}) {
  const writeHead = res.writeHead.bind(res);
  const end = res.end.bind(res);
  let captured = null;
  res.writeHead = (status, ...rest) => {
    const headers = rest.find((arg) => arg && typeof arg === 'object') || {};
    const type = String(headers['Content-Type'] || headers['content-type'] || res.getHeader('content-type') || '');
    if (status >= 400 && status < 500 && type.includes('application/json')) {
      captured = { status };
      return res;
    }
    return writeHead(status, ...rest);
  };
  res.end = (chunk, ...rest) => {
    if (!captured) return end(chunk, ...rest);
    let payload = {};
    try {
      payload = JSON.parse(String(chunk || '{}'));
    } catch {
      payload = {};
    }
    setFlashNotice(res, PAGE_NOTICE_SCOPE, refusalCode(payload.error));
    writeHead(303, { Location: resolveReturnHref(req, fallback) });
    return end();
  };
}

// Request context for the shell, so renderPage can show a page notice without
// threading req/res through every controller.
export const requestContext = new AsyncLocalStorage();

export function renderPageNotice() {
  const context = requestContext.getStore();
  if (!context?.req || !context?.res || context.res.headersSent) return '';
  return renderFlashNotice(context.req, context.res, PAGE_NOTICE_SCOPE, REFUSAL_NOTICES, { id: 'page-notice' });
}

// The notice sits directly under the page heading, outside any optional panel, so
// hiding sections can never hide why a submission was refused.
export function insertPageNotice(body, notice) {
  if (!notice) return body;
  const h1 = body.search(/<h1\b/i);
  if (h1 === -1) return `${notice}${body}`;
  const headerEnd = body.indexOf('</header>', h1);
  const h1End = body.indexOf('</h1>', h1);
  const at = headerEnd !== -1 ? headerEnd + '</header>'.length : h1End + '</h1>'.length;
  return `${body.slice(0, at)}${notice}${body.slice(at)}`;
}
