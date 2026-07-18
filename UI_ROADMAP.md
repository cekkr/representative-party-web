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

## 2. Design tokens (style) — [done], light [todo]

Implemented in [`src/public/app.css`](src/public/app.css) `:root`. **Dark-first**; a light
palette is scaffolded but unset.

- **Accent engine:** `--primary-h/s/l` → `--primary`, `--primary-strong`,
  `--primary-foreground`, `--primary-soft`, `--primary-two` (gradient companion), `--ring`.
  One hue knob (`--primary-h`) re-tints the whole system.
- **Neutrals:** `--background`, `--surface`, `--surface-2/3`, `--card`, `--foreground`,
  `--muted-foreground`, `--border`, `--border-strong`, `--nav-surface`.
- **Status:** `--success`, `--warning`, `--danger`, `--info`.
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

**[todo]** light palette (`:root[data-theme="light"]`) + a light/dark/system toggle in the
Appearance control; **[todo]** optionally self-host a variable font (Inter / Space Grotesk /
Geist) under `/public` to match the reference type exactly with no external request.

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
  - **Appearance:** accent-hue swatches + density segmented control. **[done]**
  - **Sections:** per-page show/hide list of the current page's module panels. **[done]**
  - **Interface settings:** large text, reduced motion, compact nav, keep-composer-open,
    fast partial navigation. **[done]**
  - Persistence: dynamic in `localStorage`, permanent via *Save as session defaults* →
    `person.uiSettings` (session store). Rendered on `<html>` at SSR time so it holds
    **without JavaScript**. Vocabulary is centralized in
    [`interfaceSettings.js`](src/interfaces/http/views/interfaceSettings.js); the `app.js`
    mirror (`UI_ACCENT_KEYS`/`UI_DENSITY_KEYS`/`UI_THEME_KEYS`) must stay in sync.
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

40 panels are already section-tagged across modules; **11 carry friendly
`data-section-label`s** (the home/social/forum exemplar). Untagged-label sections fall back
to their heading text in the member Sections list — **[todo]: add `data-section-label` to
the remaining 29** so the control reads cleanly everywhere.

| Module | Section keys | Labels |
| --- | --- | --- |
| home | `home-overview`, `home-lane-conversation`, `home-lane-governance`, `home-lane-federation`, `home-ops` | **[done]** all 5 |
| social | `social-wall`, `social-compose`, `social-controls`, `social-follows` | **[done]** all 4 |
| forum | `forum-threads`, `forum-compose` | **[done]** both |
| organization | `coordination-workspace`, `operating-map`, `pressure-map`, `pressure-inbox` | **[todo]** labels |
| delegation | `delegation-overview`, `delegation-recommendations`, `delegation-effective`, `delegation-set`, `delegation-current` | **[todo]** labels |
| delegates | `delegate-directory`, `delegate-directory-list`, `delegate-profile-summary`, `delegate-profile-endorsements`, `delegate-profile-delegations`, `delegate-profile-votes`, `delegate-profile-history` | **[todo]** labels |
| governance | `governance-overview`, `governance-proposals` | **[todo]** labels |
| groups | `groups-create`, `groups-list` | **[todo]** labels |
| notifications | `notifications-inbox` | **[todo]** label |
| profile | `profile-summary`, `profile-interface`, `profile-fields` | **[todo]** labels |
| auth/core | `auth-eudi`, `verification-complete`, `error-message`, `module-disabled`, `admin-required` | n/a (chromeless) |

---

## 6. Per-surface structure map

Each member-facing route: owning template, current top-level section order, and the target
structure/order pulled from the references. The token/component refresh (§2–3) already
reaches every surface; **[todo]** below means the HTML *structure* still needs the modern
card/feed rework and label pass. Home/social/forum are the shipped **exemplar**.

| Route | Template | Current top-level order | Target (reference) | Status |
| --- | --- | --- | --- | --- |
| `/` | [home.html](src/modules/home/templates/home.html) | overview → lanes (conversation/decision/audit) → ops | dashboard hero strip + stat row + activity lanes as cards | **[done]** exemplar |
| `/social/feed` | [social.html](src/modules/social/templates/social.html) | main: wall · aside: composer/filters/follows | two-column feed: sticky composer + card wall + right rail | **[done]** exemplar |
| `/forum` | [forum.html](src/modules/forum/templates/forum.html) | main: threads · aside: compose | thread list rows + right compose rail | **[done]** exemplar |
| `/organization` | [coordination.html](src/modules/organization/templates/coordination.html) + partials | workspace header → operating map → pressure board/map | inbox-first: source message, layer tabs, operating map, pressure views | **[partial]** demote hero (see OPTIMIZATIONS), label sections |
| `/discussion` | [discussion.html](src/modules/discussion/templates/discussion.html) | intake + list | modern list rows + compose | **[todo]** structure + section tags/labels |
| `/petitions` | [petitions.html](src/modules/petitions/templates/petitions.html) + partials | active/compose/discussion partials | proposal cards, stage chips, argument map | **[todo]** structure + section tags/labels |
| `/governance` | [governance.html](src/modules/governance/templates/governance.html) | overview → proposals | settings cards + change-proposal list | **[todo]** labels |
| `/delegation` | [delegation.html](src/modules/delegation/templates/delegation.html) | overview/recommendations/effective/set/current | delegate cards + chain view | **[todo]** labels |
| `/delegates` | [delegate-directory.html](src/modules/delegates/templates/delegate-directory.html) / [profile](src/modules/delegates/templates/delegate-profile.html) | directory/list; profile summary/endorsements/… | searchable people grid + profile dashboard | **[todo]** labels |
| `/groups` | [groups.html](src/modules/groups/templates/groups.html) | create → list | group cards + election panels | **[todo]** labels |
| `/notifications` | [notifications.html](src/modules/notifications/templates/notifications.html) | inbox | notification list rows | **[todo]** label |
| `/profile` | [profile.html](src/modules/profile/templates/profile.html) | summary → interface → fields | account cards + preferences | **[todo]** labels |
| `/admin` | [admin.html](src/modules/admin/templates/admin.html) | wizard/policy/modules/… | admin dashboard shell | **[todo]** structure (large template; decompose into partials) |

---

## 7. Functionality checklist

| Capability | State |
| --- | --- |
| SSR renders fully without JS; full vs partial parity | **[done]** invariant |
| Partial navigation (`data-partial`) + enhanced forms | **[done]** |
| Verbosity (compact/full: default, per-session, per-page presets) | **[done]** |
| Appearance: accent hue | **[done]** |
| Appearance: density | **[done]** |
| Appearance: light/dark/system toggle | **[todo]** (needs light palette) |
| Sections: member per-page show/hide (SSR + live) | **[done]** |
| Admin Composer: text/style/reorder/hide/theme defaults | **[done]** |
| Side-nav jump filter (`Ctrl/Cmd+K`, `/`, `Esc`) | **[done]** |
| Sticky social composer auto-collapse | **[done]** |
| Favicon (kills `/favicon.ico` 404) | **[todo]** (see OPTIMIZATIONS) |
| Mobile nav: accessible disclosure instead of height cap | **[todo]** (see OPTIMIZATIONS) |

---

## 8. To-implement backlog (ordered)

1. **Light palette + toggle** — fill `:root[data-theme="light"]` from the references'
   light tokens; add `light`/`dark`/`system` to `THEME_KEYS` + the Appearance control +
   the `app.js` mirror; respect `prefers-color-scheme` for `system`.
2. **Label the remaining 29 sections** (§5) with `data-section-label` so the member
   Sections control reads cleanly on every surface.
3. **Roll the modern structure out** beyond the exemplar (§6 `[todo]` rows), one surface
   per pass, holding each to [UIReview.md](principle-docs/UIReview.md); tag any new panels.
4. **Self-host a variable font** under `/public` (no external request) for exact reference
   typography; ship with the light palette.
5. **Composer palette** — component insert/delete/wrap + richer property groups (already a
   ROADMAP Phase-2 item).
6. **Chrome fixes** — favicon; admin composer-bar/status-strip overlap on narrow widths;
   mobile side-nav disclosure.
7. **De-duplicate the accent/density vocabulary** so the `app.js` mirror can't drift from
   [`interfaceSettings.js`](src/interfaces/http/views/interfaceSettings.js) (see OPTIMIZATIONS).

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
