# UI Review Guideline (default AI test)

Status: standing procedure. Run this whenever you touch presentation — templates,
`app.css`, view helpers, or anything that changes what a member sees.

The bar is explicit: the interface must read as a **real forum / social product**,
not a scholar-project demo or a telemetry dashboard. "The routes return 200" is not
the test. The test is whether a member of *Rete Civica Nazionale* would recognise the
screen as a place they participate.

## Why Scenario A is the default lens

Screenshots and UX judgements default to **Scenario A — Rete Civica Nazionale**
(`principle-docs/RepresentativeParties.md`, `principle-docs/SimulationScenarios.md`).
It exercises the member-facing feed surfaces (discussion, forum, social, proposals,
delegation, People) with real deliberation content — English copy about real Italian
policy questions — verified people, and attribution — exactly the surfaces where "demo-like" defects hide. Scenario B (ASL
organization operations) is the secondary lens for the `/organization` workspace only;
do **not** let it become the product's default face.

## The procedure

```bash
# 1. Fresh, seeded, strict-Circle party deployment
rm -rf .local/standalone
ENFORCE_CIRCLE=true CIRCLE_POLICY_ID=rete-civica-nazionale CIRCLE_NAME="Rete Civica Nazionale" \
  DATA_VALIDATION_LEVEL=strict DATA_PREVIEW=false ./run-standalone.sh   # terminal 1

# 2. Seed + drive + capture the member journey (asserts each step, writes 20 images)
BASE_URL=http://127.0.0.1:3000 OUT_DIR=md-assets/party node scripts/party-journeys.js
```

3. Open the live UI and walk every member-facing page: `/discussion`, `/forum`,
   `/social/feed`, `/petitions`, `/delegation`, `/delegates`, `/groups`, `/governance`,
   plus `/` and `/organization`. Look at each with the checklist below.
4. Fix defects in source (templates / `app.css` / view helpers), restart, re-verify.
5. Regenerate committed images and confirm they match the README prose
   (`OUT_DIR=md-assets/party node scripts/party-journeys.js`). The README carries only
   Scenario A captures; `scripts/user-journeys.js` is an organization-operations
   regression driver and writes to `.local/journeys`, not to `md-assets/`.
6. Run `npm run test:ui` (and the focused view tests) before committing.

Note: the in-app browser screenshot tool captures reliably only at scroll-top. To see
content below the fold, either resize the viewport taller before capturing, or read the
Puppeteer-generated images the journey scripts write.

## The checklist

**Content-first layout** — the page's actual subject (the feed, the proposal, the
people) sits near the top. Brand chrome, the operator/status strip, and "what applies
to me" context are secondary and compact. If a member has to scroll past a screen of
chrome to reach the first post, that is a defect.

**Identity affordances** — people look like people. Every authored item carries an
avatar (colour keyed to the actor, initial from the handle) and a `@handle` byline with
the short blinded-hash cue. Never surface a raw hash as the primary identity; never bury
the author in a footer label like `Author: …`.

**Feed cards, not label dumps** — discussion/forum/social posts read as feed items:
avatar + byline + timestamp on top, content indented under it, meaning-carrying chips
(stance, evidence, visibility) coloured so the shape of a debate is legible at a glance.

**No debug-dump panels** — identity/state facts render as a quiet inline chip row, not a
bordered `label: value` grid. Gates ("Allowed / Blocked") are what the reader acts on;
keep them distinct from facts and guidance (`renderContextPanel`).

**Calm visual system** — surfaces step up in lightness to show hierarchy; glow, neon,
and radial gradients are the exception, not the theme. Pills are small and quiet.
Nothing should look like a synthwave HUD.

**No provenance noise** — the "from {issuer}" pill only appears for genuinely federated
content, never for locally-authored posts (`local-circle` / own issuer are suppressed).

**Deterministic, locale-appropriate dates** — dates render `dd/mm/yyyy` regardless of
the host machine's locale, so Italian content reads correctly and screenshots are
reproducible. Never emit machine-locale `m/d/yyyy`.

**English copy, Italian world** — every string a member reads (posts, proposals, group
and category names, notes) is English; only names, handles, institutions, and legal
citations stay Italian. A capture with Italian copy fails the review.

**Replies read after what they answer** — inside a thread (forum replies, proposal
discussion, argument-map rebuttals) the order is oldest-first, and a rebuttal names the
claim it builds on rather than a raw node id. Feeds of *threads* stay newest-first.

**Every screen has a story** — per `SimulationScenarios.md`, no empty states in the
seeded deployment, and every number on screen has content behind it. An empty feed or a
placeholder proposal is hiding a defect, not passing the test.

## Anti-patterns this guideline exists to catch

These were all live in the codebase before the first pass; treat their return as a
regression:

- A full screen of brand header + status pills + context `label:value` dump above the
  first post.
- Empty grey avatar discs, or authors shown only as `Author: @x hash…` in a footer.
- `from local-circle` stamped on every home-grown post.
- `7/17/2026`-style US dates from `new Intl.DateTimeFormat()` with no locale.
- Row lists (People directory, follows) rendered as unstyled vertical stacks with no
  aligned identity column or right-aligned actions.
