import { parseCookies } from '../../../shared/utils/request.js';
import { renderFormNotice } from './formFeedback.js';

// What a form handler did, reported beside its message. The notice tone follows
// the outcome, never the wording: "Confirm the merge first" applied nothing,
// however politely it is phrased. Admin re-exports this as ADMIN_OUTCOME.
export const FORM_OUTCOME = Object.freeze({
  APPLIED: 'applied',
  PARTIAL: 'partial',
  NOT_APPLIED: 'not_applied',
});

const OUTCOMES = new Set(Object.values(FORM_OUTCOME));

export function isFormOutcome(outcome) {
  return OUTCOMES.has(outcome);
}

// Only an applied outcome without field errors reads as a confirmation. A
// missing or unknown outcome is a handler bug, so it reads as a warning.
export function resolveOutcomeTone(outcome, { hasErrors = false } = {}) {
  return hasErrors || outcome !== FORM_OUTCOME.APPLIED ? 'warning' : 'success';
}

export function renderOutcomeNotice(message, outcome, { hasErrors = false, id } = {}) {
  const known = isFormOutcome(outcome) ? outcome : FORM_OUTCOME.NOT_APPLIED;
  return renderFormNotice(message, { id, tone: resolveOutcomeTone(known, { hasErrors }) });
}

// A POST that redirects (Post/Redirect/Get) cannot carry its message in the
// redirect URL without changing the canonical address — every group write lands
// on `/groups?group=<id>&view=…` and tests, bookmarks and Back all rely on it.
// The handler instead sets a one-shot cookie naming a *catalog code*, and the
// GET it redirects to renders that code's fixed message and clears the cookie.
// The cookie never carries text, so a forged one can at most pick another
// message from the same catalog; an unknown scope or code renders nothing.
export const FLASH_COOKIE = 'wo_notice';
const FLASH_MAX_AGE_SECONDS = 60;
const TOKEN = /^[a-z0-9-]{1,40}$/;

function flashCookie(value, maxAge) {
  return `${FLASH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

export function setFlashNotice(res, scope, code) {
  if (!TOKEN.test(String(scope)) || !TOKEN.test(String(code))) return;
  appendSetCookie(res, flashCookie(`${scope}.${code}`, FLASH_MAX_AGE_SECONDS));
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader?.('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

// Reads this scope's pending notice and clears it on the response that shows it.
// A notice for another scope stays put for the page it belongs to.
export function takeFlashNotice(req, res, scope, catalog = {}) {
  const raw = parseCookies(req?.headers?.cookie || '').get(FLASH_COOKIE) || '';
  const [cookieScope, code] = raw.split('.');
  if (cookieScope !== scope || !TOKEN.test(code || '')) return null;
  appendSetCookie(res, flashCookie('', 0));
  const entry = Object.prototype.hasOwnProperty.call(catalog, code) ? catalog[code] : null;
  if (!entry) return null;
  return { code, outcome: entry.outcome, message: entry.message };
}

export function renderFlashNotice(req, res, scope, catalog, options = {}) {
  const notice = takeFlashNotice(req, res, scope, catalog);
  return notice ? renderOutcomeNotice(notice.message, notice.outcome, options) : '';
}

// A browser navigating with an ordinary form asks for HTML. Script and API
// clients that post without that Accept keep the structured JSON refusal.
export function prefersHtmlNavigation(req) {
  return String(req?.headers?.accept || '').toLowerCase().includes('text/html');
}

// The ordinary HTML form posts as urlencoded (or multipart); a JSON body is an API client.
export function isHtmlFormPost(req) {
  const type = String(req?.headers?.['content-type'] || '').toLowerCase();
  return type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data');
}
