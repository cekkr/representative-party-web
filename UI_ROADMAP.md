# UI Roadmap & Reference

This is the standing UI reference for the **Web Organization Framework**: the design
language it targets, what is implemented, and what remains — across **HTML structure**,
**section order**, **functionality**, and **style**. It exists because the two commercial
templates the owner uses as visual references are licensed CodeCanyon products that
**cannot be vendored into this GPL repo**, so their design language is distilled here
instead.

Keep it synchronized with [ROADMAP.md](ROADMAP.md) (overall product phases),
[AGENTS.md](AGENTS.md) (implementation contracts), [OPTIMIZATIONS.md](OPTIMIZATIONS.md)
(follow-up backlog), and the standing [principle-docs/UIReview.md](principle-docs/UIReview.md)
review procedure. When presentation changes, update this file in the same task.

Legend: **[done]** shipped and verified · **[partial]** present but incomplete ·
**[todo]** not started.

---

## 1. External style references (not vendored)

Two local CodeCanyon apps are the visual/structural north star. They live on the owner's
disk only — do not copy their code or assets into this repo.

- **ForumLab — Community Discussion Platform** (`codecanyon-FXBzXFy2-…`). Use its **modern**
  template — `Files/assets/templates/modern/css/main.css` — as the closest match: HSL
  design-token scale on a `--base` hue ≈ 248, Space Grotesk headings + Inter body, rounded
  cards, forum/thread list structure, sidebar + feed layout.
- **Ultimate Project Manager CRM (Zisco ERP)** (`codecanyon-DjGLSU35-…`, CSS inside
  `ZiscoERP.zip` at `assets/css/app.css`). Use its **shadcn-style token system**: HSL
  semantic tokens (`--primary`, `--card`, `--muted`, `--border`, `--ring`, `--sidebar-*`),
  light **and** dark palettes toggled by a class on the root, `--radius`, Geist typography,
  and a persistent left **sidebar app-shell**.

**Convergent takeaways** both share and this project adopts: one indigo/violet **primary
hue** drives an HSL semantic-token system; neutral surfaces step up in lightness; rounding
and soft elevation over glow; a sidebar + main-column app-shell; light+dark support.

**Divergence we keep on purpose:** no external font/CDN requests (privacy/provider-local
posture) — we use a system/Inter stack, not the references' Google-Fonts pulls.

---

## 2. Design tokens (style) — [done]

Implemented in [`src/public/app.css`](src/public/app.css) `:root`. **Dark-first**, with a
full light palette.

- **Accent engine:** `--primary-h/s/l` → `--primary`, `--primary-strong`,
  `--primary-foreground`, `--primary-soft`, `--primary-two` (gradient companion), `--ring`.
  One hue knob (`--primary-h`) re-tints the whole system.
- **Accent ink:** `--primary-ink` — text that sits *on* an accent-tinted chip. `--primary`
  is tuned as a fill; at L66% on its own 14% tint it only reaches 3.5:1, so tinted chips
  take this instead. Follows the live hue/saturation, so accent presets keep working.
- **Neutrals:** `--background`, `--surface`, `--surface-2/3`, `--card`, `--foreground`,
  `--muted-foreground`, `--border`, `--border-strong`, `--nav-surface`.
- **Status:** `--success`, `--warning`, `--danger`, `--info`, each backed by an
  `-hsl` channel triplet (`--warning-hsl`, …) so a component can take the same colour at
  its own alpha rather than hardcoding a second, theme-blind `rgba()` of the same hue.
- **Neutral families** (also triplets, same reason — dozens of rules take them at a dozen
  alphas): `--hairline-hsl` (rules, dashed guides, gridlines), `--inset-hsl` /
  `--inset-2/3/4-hsl` (recessed wells and popover backdrops, deepest first),
  `--marker-hsl` (the mint "active / selected / audited" marker), plus `--on-accent`
  (ink on an accent-filled shape) and `--code-surface`. **The inset family flips from
  near-black to near-white in the light palette** — without it every recessed panel would
  render as a black hole on a white page.
- **Overlay tints:** `--overlay-softer`, `--overlay-soft`, `--overlay-strong` — the
  "subtle lift" washes on top of a surface. They invert with the theme; a white wash is
  invisible on a light background.
- **Radius scale:** `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill`.
- **Elevation:** `--shadow`, `--shadow-soft`.
- **Density:** `--density-scale` → `--pad-card`, `--gap-stack`.
- **Back-compat aliases:** legacy hex names (`--bg`, `--text`, `--muted`, `--highlight`,
  `--accent`, …) resolve onto the tokens so all component CSS works unchanged. **Do not
  reintroduce raw hex in components.**

**Scope rule (critical):** accent/density/theme attributes live on the **`<html>`**
element (`data-ui-accent` / `data-ui-density` / `data-theme`), never `<body>`. The token
layer is declared on `:root` and resolves its nested `var(--primary-h)` there; a
`<body>`-level override is silently ignored by the derived tokens. Preset rules are scoped
`:root[data-ui-accent="…"]` / `:root[data-ui-density="…"]`.

Accent presets: `violet` (default), `blue`, `teal`, `green`, `rose`, `amber`.
Density presets: `comfortable` (cozy, default), `compact`, `relaxed`.
Themes: `dark` (default), `light`, `system`.

**Light palette — [done].** `:root[data-theme="light"]` re-declares only the
neutral/status/overlay block; the accent engine still derives from `--primary-h`, so every
preset works in both themes (the primary is darkened to L52% because a 66%-lightness
violet fails contrast on a near-white surface). `color-scheme` is declared per theme so
native widgets (scrollbars, date pickers) match.

**`system` is resolved by CSS, not JavaScript** — `data-theme="system"` plus a
`prefers-color-scheme` media query — so it holds on the first paint and with JS disabled:
no theme flash, no client round trip. Plain CSS cannot share one declaration body between
a bare selector and a media-query-scoped one, so the light palette is written **twice**.
`tests/interface-settings.test.js` asserts the two bodies stay identical — **edit both**.

**Contrast is verified, not assumed:** every member-facing route was audited in both
themes against WCAG AA (4.5:1 body, 3:1 large). The pass also fixed three pre-existing
dark-mode failures — avatar discs (62%→66% lightness, blue hues were at 4.08:1), the
`stance--question`/`--neutral` chips (3.5:1, now on `--primary-ink`), and the
`stance--proposal` chip, which was pinned to a fixed violet and stopped matching once a
member repicked their accent.

**[todo]** optionally self-host a variable font (Inter / Space Grotesk / Geist) under
`/public` to match the reference type exactly with no external request.

---

## 3. Components (style + structure) — [done], polish ongoing

Re-skinned in [`src/public/app.css`](src/public/app.css), reusing existing class names so
all 37 templates inherit at once. Token-driven, focus rings via `--ring`.

- **[done]** Buttons (`.cta` primary gradient, `.ghost` secondary), panels/cards (`.panel`
  with density padding + `--radius-lg`), side-nav app-shell, topbar, pills/chips
  (`.pill`, stance/stage variants), fields/inputs, avatars, callouts, stat tiles,
  segmented control, accent swatches, global `:focus-visible` ring.
- **[partial]** Composer tool + Interface panel chrome modernized; the admin composer bar
  can overlap the status strip on very narrow widths (admin-only) — see
  [OPTIMIZATIONS.md](OPTIMIZATIONS.md).
- **[todo]** A documented component palette (see §7 rollout): thread/list rows, feed cards,
  empty states, and table styles hardened to the reference "modern" bar on every surface.

---

## 4. Ad-hoc modularity (functionality) — [done]

Two distinct, coexisting customization surfaces. See the AGENTS contract *"Member appearance
and modularity"* for invariants.

- **Member Interface panel** ([`topbar.html`](src/modules/core/templates/partials/topbar.html),
  driven by [`app.js`](src/public/app.js)) — per-member, per-view, non-binding on anyone else:
  - **Appearance:** accent-hue swatches, theme (dark/light/system) and density segmented
    controls. **[done]**
  - **Sections:** per-page show/hide list of the current page's module panels. **[done]**
    Lists only panels that opted in from their template. The admin Composer synthesizes
    an index-derived key (`panel-N`) for untagged panels; those are flagged
    `data-composer-synthetic` and excluded, because such a key shifts when the page
    changes shape and the server knows nothing about it — hiding one would not survive
    SSR.
  - **Interface settings:** large text, reduced motion, compact nav, keep-composer-open,
    fast partial navigation. **[done]**
  - Persistence: dynamic in `localStorage`, permanent via *Save as session defaults* →
    `person.uiSettings` (session store). Rendered on `<html>` at SSR time so it holds
    **without JavaScript**. Vocabulary is centralized in
    [`interfaceSettings.js`](src/interfaces/http/views/interfaceSettings.js) and shipped to
    the browser on `data-ui-vocabulary`, so there is no hand-maintained mirror to drift.
- **Admin Composer** ([`buildComposerControls`](src/interfaces/http/views/templates.js) +
  `app.js`) — deployment-wide brand/layout defaults: inline text/style overrides, drag
  reorder, panel hide/show, theme CSS. Admin-gated (`composerAllowed = isAdmin`). **[done]**

**Shared contract:** a panel becomes reorderable/hideable by carrying
`data-composer-section="<stable-key>"` (and a friendly `data-section-label`) in its template.
Server-side, `applyMemberHiddenSections` in [`templates.js`](src/interfaces/http/views/templates.js)
stamps `data-member-hidden="true"`; `app.js` re-applies live and never fights an open
Composer.

---

## 5. Section / modularity inventory

70 panels are section-tagged across modules. **All 65 chrome-bearing panels carry a
friendly `data-section-label`** — **[done]**. The 5 auth/core pages render no shell, so
the member Sections control never lists them and a label there would be dead markup.
`tests/interface-settings.test.js` enforces the rule, so a new panel cannot ship unlabeled.

Without a label the control falls back to heading text, which reads as page copy rather
than a control — that is what the label pass removed.

| Module | Section keys | Labels |
| --- | --- | --- |
| home | `home-overview`, `home-lane-conversation`, `home-lane-governance`, `home-lane-federation`, `home-ops` | **[done]** all 5 |
| social | `social-wall`, `social-compose`, `social-controls`, `social-follows` | **[done]** all 4 |
| forum | `forum-threads`, `forum-compose` | **[done]** both |
| discussion | `discussion-feed`, `discussion-compose`, `discussion-filters`, `discussion-topics` | **[done]** all 4 |
| petitions | `petitions-active`, `petitions-discussion`, `petitions-compose`, `petitions-filters`, `petitions-delegates` | **[done]** all 5 |
| organization | `coordination-workspace`, `operating-map`, `pressure-map`, `pressure-inbox` | **[done]** all 4 |
| delegation | `delegation-overview`, `delegation-inbox`, `delegation-my-ballots`, `delegation-recommendations`, `delegation-effective`, `delegation-set`, `delegation-current` | **[done]** all 7 |
| delegates | `delegate-directory`, `delegate-directory-list`, `delegate-profile-summary`, `delegate-profile-endorsements`, `delegate-profile-delegations`, `delegate-profile-votes`, `delegate-profile-history` | **[done]** all 7 |
| governance | `governance-overview`, `governance-proposals` | **[done]** both |
| groups | `groups-create`, `groups-list`, `groups-categories` | **[done]** all 3 |
| notifications | `notifications-inbox`, `notifications-preferences` | **[done]** both |
| profile | `profile-summary`, `profile-interface`, `profile-fields` | **[done]** all 3 |
| governance | + `governance-propose` | **[done]** all 3 |
| delegates | + `delegate-directory` reused for search | **[done]** |
| admin | `circle-settings`, `governance-settings`, `modules`, `composer`, `rate-limits`, `social-media`, `upload-cleanup`, `structure-manager`, `provider-profiles`, `topic-gardener-review`, `federation-gossip`, `provider-blind`, `admin-audit`, `ops-metrics`, `metrics-retention`, `admin-transactions`, `outbound-delivery`, `transaction-summaries`, `extensions`, `session-overrides` | **[done]** all 20 |
| auth/core | `auth-eudi`, `verification-complete`, `error-message`, `module-disabled`, `admin-required` | n/a (chromeless) |

Two notes from the label pass:

- **`notifications-preferences` was untagged.** It is rendered from a controller string
  (`renderPreferencesPanel` in [notifications.js](src/modules/notifications/http/notifications.js)),
  not a template, so it never opted in. It now carries a key and a label.
- **Labels describe the panel's visible content, not its key.** In
  [profile.html](src/modules/profile/templates/profile.html) and
  [delegate-profile.html](src/modules/delegates/templates/delegate-profile.html) the keys
  are rotated one position out of step with the panels they sit on (`profile-summary`
  wraps the *attributes* panel; `delegate-profile-delegations` wraps *vote history*).
  Renaming them would invalidate members' stored `hiddenSections` and any saved Composer
  layout, so it needs a migration — logged in [OPTIMIZATIONS.md](OPTIMIZATIONS.md).

---

## 6. Per-surface structure map

Each member-facing route: owning template, current top-level section order, and the target
structure/order pulled from the references. The token/component refresh (§2–3) reaches
every surface, and every panel is now section-tagged and labelled (§5); **[todo]** below
means the HTML *structure* still needs the modern card/feed rework.

**The exemplar shape** (home/social/forum, now also discussion/petitions): a
`.page-grid` with the *content* in `.page-main` and short controls in the `.page-aside`
rail. Content leads — a compose form never sits above the feed it contributes to.

| Route | Template | Current top-level order | Target (reference) | Status |
| --- | --- | --- | --- | --- |
| `/` | [home.html](src/modules/home/templates/home.html) | overview → lanes (conversation/decision/audit) → ops | dashboard hero strip + stat row + activity lanes as cards | **[done]** exemplar |
| `/social/feed` | [social.html](src/modules/social/templates/social.html) | main: wall · aside: composer/filters/follows | two-column feed: sticky composer + card wall + right rail | **[done]** exemplar |
| `/forum` | [forum.html](src/modules/forum/templates/forum.html) | main: threads · aside: compose | thread list rows + right compose rail | **[done]** exemplar |
| `/discussion` | [discussion.html](src/modules/discussion/templates/discussion.html) + partials | main: feed · aside: compose/filters/topics | modern list rows + right rail | **[done]** |
| `/petitions` | [petitions.html](src/modules/petitions/templates/petitions.html) + partials | main: active proposals/deliberations · aside: compose/stage filter/delegates | proposal cards, stage chips, argument map | **[done]** structure; argument-map polish outstanding |
| `/organization` | [coordination.html](src/modules/organization/templates/coordination.html) + partials | workspace strip → pressure inbox → organizational mirror → operating map | inbox-first: source message, layer tabs, operating map, pressure views | **[done]** hero demoted to a strip; inbox above the fold |
| `/governance` | [governance.html](src/modules/governance/templates/governance.html) | main: constitution → change proposals · aside: propose a change | settings cards + change-proposal list | **[done]** |
| `/delegation` | [delegation.html](src/modules/delegation/templates/delegation.html) | main: overview → delegated-ballot inbox → your delegated ballots → current → effective chains · aside: set a delegate/recommendations | delegate cards + chain view + ballot inbox | **[done]** |
| `/delegates` | [delegate-directory.html](src/modules/delegates/templates/delegate-directory.html) / [profile](src/modules/delegates/templates/delegate-profile.html) | directory — main: people list · aside: search. profile — main: summary/coverage/votes/activity · aside: endorsements | searchable people grid + profile dashboard | **[done]** |
| `/groups` | [groups.html](src/modules/groups/templates/groups.html) | main: group tree (branches indented under parents) → category directory · aside: create a group | group cards + election panels + category directory | **[done]** |
| `/notifications` | [notifications.html](src/modules/notifications/templates/notifications.html) | main: alerts inbox · aside: alert preferences | notification list rows | **[done]** |
| `/profile` | [profile.html](src/modules/profile/templates/profile.html) | main: session/handle → provider-local attributes · aside: interface controls | account cards + preferences | **[done]** |
| `/admin` | [admin.html](src/modules/admin/templates/admin.html) + partials | 20 anchored panels, single column | admin dashboard shell | **[done]** decomposed into 7 partials; single column on purpose (see below) |

**`/admin` stays a single column deliberately.** The reference "dashboard shell" is a
persistent left sidebar plus a main content column — which the app already has, in the
shared side-nav. A settings page whose 20 panels are each a jump target reads better as
one column than split across a rail, and every panel is now section-tagged so a member
can hide the ones they don't operate. What it did need was decomposition: `admin.html`
was a single 742-line template and is now 7 grouped partials
([setup](src/modules/admin/templates/partials/admin-setup.html), modules, policy,
structure, federation, observability, operations), which also closes the ROADMAP
template-hygiene item.

### Layout rules the rollout established

- **The rail is a plain column.** `.page-aside` is not sticky, has no `max-height`, and
  does not scroll internally. Both alternatives break once a panel outgrows the viewport:
  `overflow: auto` clips an expanded compose form so its own submit button sits outside
  the rail's visible box, and `position: sticky` is worse — a sticky element taller than
  the viewport pins at `top` and then stops moving, so nothing below the fold can be
  scrolled to at all. In both cases the member simply cannot submit. Only a genuinely
  short, fixed-height panel may pin itself (`.sticky-composer` on the social composer).
  `tests/ui.test.js` → *compose forms stay reachable at a short viewport* guards this.
- **The grid collapses on its own width, not the viewport's.** `.shell main` declares
  `container-type: inline-size`, and `.page-grid` collapses via
  `@container shell-main (max-width: 700px)`. A viewport-keyed breakpoint ignored the
  ~240px side-nav and left the main column at ~160px on a ~850px screen while the aside
  kept its full 360px. The old `@media (max-width: 720px)` rule stays as a fallback.

---

## 7. Functionality checklist

| Capability | State |
| --- | --- |
| SSR renders fully without JS; full vs partial parity | **[done]** invariant |
| Partial navigation (`data-partial`) + enhanced forms | **[done]** |
| Verbosity (compact/full: default, per-session, per-page presets) | **[done]** |
| Appearance: accent hue | **[done]** |
| Appearance: density | **[done]** |
| Appearance: light/dark/system toggle | **[done]** (`system` resolved by CSS, holds without JS) |
| Sections: member per-page show/hide (SSR + live) | **[done]** |
| Admin Composer: text/style/reorder/hide/theme defaults | **[done]** |
| Side-nav jump filter (`Ctrl/Cmd+K`, `/`, `Esc`) | **[done]** |
| Sticky social composer auto-collapse | **[done]** |
| Delegated-ballot state on `/petitions` (holder, countdown, override) | **[done]** |
| Delegate ballot inbox + member ballot list on `/delegation` | **[done]** |
| Group tree: branches indented under their parent, lineage on the card | **[done]** |
| Category directory (`/groups`): who works on what, one-click delegate | **[done]** |
| Group lane tabs + destination picker on `/discussion` and `/petitions` | **[done]** |
| Promote-to-upper-level control (shown only when it would succeed) | **[done]** |
| Promotion request + approve/decline controls (both lanes) | **[done]** |
| Group members-and-roles panel (lane moderator assignment) | **[done]** |
| Scenario A README coverage, all English copy: discussion, forum, proposal/revisions/deliberation/vote, delegation, election, branch tree, category directory, internal lane, promotion, delegated ballot + delegate inbox, People, delegate dashboard, governance change, social (`party-journeys.js`, 20 captures). The README carries no non-political walkthrough | **[done]** |
| Thread order: forum replies and proposal discussion read oldest-first; the comment form follows the notes; rebuttals name the claim they build on | **[done]** |
| Ballot select starts on the member's current vote ("Change vote"), never back on abstain | **[done]** |
| Group election panel leads with results; "start a new election" follows | **[done]** |
| Governance history reads as decisions ("Approved — …", proposer vs decider) instead of event types | **[done]** |
| Cachet / delegation-topic labels in the member's casing (`Healthcare / Waiting lists`, not the normalised key) | **[todo]** (see OPTIMIZATIONS) |
| Proposal Category field (compose + draft edit) with topic datalist | **[done]** |
| Favicon (kills `/favicon.ico` 404) | **[todo]** (see OPTIMIZATIONS) |
| Mobile nav: accessible disclosure instead of height cap | **[todo]** (see OPTIMIZATIONS) |

---

## 8. To-implement backlog (ordered)

1. ~~**Light palette + toggle**~~ — **[done]**, see §2.
2. ~~**Label the remaining sections**~~ — **[done]**, see §5, test-enforced.
3. ~~**De-duplicate the accent/density vocabulary**~~ — **[done]**. The layout ships
   `data-ui-vocabulary` from [`interfaceVocabulary()`](src/interfaces/http/views/interfaceSettings.js);
   `app.js` reads it and keeps its literals only as a fallback for a pre-deploy body, so
   adding a key server-side needs no second edit.
4. ~~**Roll the modern structure out** beyond the exemplar~~ — **[done]**. Every
   member-facing route now uses the `.page-grid` shape (§6), `/admin` is decomposed into
   partials, and the whole set is verified per
   [UIReview.md](principle-docs/UIReview.md): 13 routes × 2 themes, zero contrast
   failures, zero horizontal overflow, every panel labelled.
5. **Self-host a variable font** under `/public` (no external request) for exact reference
   typography.
6. **Composer palette** — component insert/delete/wrap + richer property groups (already a
   ROADMAP Phase-2 item).
7. **Chrome fixes** — favicon; admin composer-bar/status-strip overlap on narrow widths;
   mobile side-nav disclosure.
8. **Rename the rotated section keys** in `profile.html` / `delegate-profile.html` behind a
   migration for stored `hiddenSections` and Composer layouts (§5).

Performance/redundancy follow-ups (e.g. `applyMemberHiddenSections` per-key rescan) live in
[OPTIMIZATIONS.md](OPTIMIZATIONS.md).

---

## 9. Invariants (see AGENTS.md for the authoritative contract)

- Preserve every `data-composer-key/-default/-section/-role/-section-label`, `data-partial`,
  `data-ui-setting`, `data-verbosity*`, and `data-member-hidden` hook.
- SSR must work without JS; full and partial HTML must stay consistent.
- No external network requests (fonts/CDN). System/Inter stack only.
- Reuse shared view helpers ([actorLabel](src/interfaces/http/views/actorLabel.js),
  [contextPanel](src/interfaces/http/views/contextPanel.js),
  [status](src/interfaces/http/views/status.js), pagination) — no local dupes.
- Accent/density/theme belong on `<html>`, not `<body>` (§2 scope rule).
- Member customization → `person.uiSettings`; deployment defaults → admin Composer. Never
  merge the two persistence paths.
- Components stay theme-agnostic: they resolve through token names only. Never add a
  `:root[data-theme="…"]` override to a component rule — retune the token instead.
- The two light-palette blocks (`[data-theme="light"]` and the `system` media query) must
  stay identical; a test enforces it.
- New panels ship with **both** `data-composer-section` (a stable, meaningful key — never
  index-derived) and `data-section-label`; a test enforces the label.
