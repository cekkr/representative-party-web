# Future Optimizations

This file tracks follow-up ideas that are out of scope for the current patch but would further improve performance, reduce redundancy, or tighten UX consistency.

## Performance
- Lazy-render organization layer detail after the active tab (especially hierarchy maps and pressure analytics) so email-only deployments do not pay the HTML/DOM cost of disabled preview panels on every `/organization` request.
- Cache permission-safe organization-pressure aggregates by scope + time window and invalidate them from case/commitment/sector writes instead of rescanning all cases for every organizational-mirror render.
- Maintain incremental volume/velocity/persistence/spread counters per sector and reporting window once live pressure analytics land; retain raw component access for explainability rather than caching only a composite score.
- Consider cursor-based windows for very large datasets (discussion, petitions, forum threads, and the social feed now use offset pagination via the shared `paginate`/`renderPager` helpers).
- Cache rendered navigation links keyed by module settings to avoid rebuilding nav HTML on every request.
- Lazy-load heavyweight admin panels (transactions, media review, topic gardener) via partial renders to shrink initial HTML payloads.
- Maintain optional maps for frequently accessed collections (posts/media/petitions) to avoid repeated `Array.find` calls in hot paths.
- Cache per-handle follow-type counts (or increment on follow/unfollow) to avoid recomputing tallies on every social feed render.
- Cache normalized topic keys in entries to avoid repeated normalization and filtering in topic views.
- Add write-behind queues for persistence to batch JSON writes during bursty activity (discussion/posts/comments).
- Add request-scoped memoization for common lookups (policy, actor labels, person/session) inside controllers.
- Track incremental counts in state (discussions/petitions/groups) to avoid full scans when only counts are needed.
- Add bounded list windows (e.g., keep latest N for discussions/social) with optional archive paging to limit memory growth.
- Cache outbound delivery summaries instead of scanning the full transactions list on every `/admin` or `/health` render.
- Pre-render or memoize petition evidence link lists (sanitized anchors) to avoid repeated normalization on each petitions render.
- Cache petition discussion stance counts (support/concern/question/note) to avoid recomputing summaries on every render.
- Precompute petition comment summaries (last comment time, stance counts, argument node totals) per petition to reduce repeated passes during render.
- Cache vote and signature tallies per petition (or update incrementally on new votes/signatures) to avoid full scans on every proposal render.
- Memoize petition argument-map trees and structured-outline rendering so large proposal pages avoid repeated traversal work.
- Cache sorted viewport element lists and build locator indexes in `agent-viewport` when running many assertions to avoid repeated sort/filter passes.
- Cache delegate profile stats (delegations, votes, activity totals) to avoid scanning full collections on every profile view.
- `renderActorLabel`/`resolveHandleForHash` call `findSessionByHash` per actor per render (feeds/lists can resolve the same hashes repeatedly); build a per-request hash→handle memo (the session index is already cached, but the lookup + fallback synthesis repeats) when rendering large lists.
- Memoize the deliberation-score inputs alongside delegate profile stats so the reputation badge does not re-scan votes/petitions/discussions per profile render.
- Build the per-topic `byOwner` delegation map once per request (or cache by topic + delegations revision) instead of rebuilding it on every `resolveDelegation`/`buildDelegationChain` call when resolving many topics (e.g., the `/delegation` effective-chains view or batch auto-vote resolution).
- Memoize `getDelegationDecayDays`/`activeDelegations` per request: each `resolveDelegation` call re-reads + normalizes governance settings and re-filters/re-decays the full delegations list, so the effective-chains view (one call per topic) repeats that work N times.
- Use ResizeObserver/IntersectionObserver to update composer overlay bounds only when selection or layout changes, avoiding continuous scroll listeners.
- Cache composer target queries (panels/nav zones) and refresh only on navigation or mutation events to avoid full DOM scans on every refresh/drag.
- Rebuild composer hierarchy trees via a MutationObserver + debounce rather than regenerating the full tree on every refresh or reorder.
- Cache grid drag candidate rects per drag session (or throttle dragover to rAF) to reduce layout thrash during composer reorder.
- Cache ring public key sets per ringId and memoize ring signature verification results to reduce repeated verification during gossip syncs.
- Normalize and pre-parse ring public keys when saving provider-blind settings to avoid per-verify PEM normalization work.
- Maintain follower/following adjacency maps keyed by hash to avoid scanning `state.socialFollows` for feed and relationship lookups.
- Add adaptive gossip pull concurrency limits (batch peers in configurable windows) to avoid saturating sockets on large rings while keeping pull sync parallel.
- Precompute/lazily refresh side-nav search indexes (per nav item + child links) so keyboard filtering avoids rebuilding lowercase haystacks on each keystroke.
- Cache module-family grouping summaries (home/admin module lanes) and refresh only when module settings change to avoid repeated per-request regrouping.
- Cache home workspace summaries (conversation/governance/audit lists plus access counts) and invalidate on social/discussion/petition/notification/transaction writes so `GET /` avoids repeated multi-collection scans.
- Cache rendered governance proposal/history summaries or precompute small decision counters if community constitution workflows grow beyond the capped settings-backed lists.
- Cache extension catalog metadata by file mtime (or use sidecar manifests) so `/admin` and `/extensions` do not import every discovered module on each catalog read; use the same mtime/version key to cache-bust ESM imports after provider-local upgrades.

## Redundancy
- Generate the organization layer rail, admin module cards, readiness list, canonical case extensions, and empty states from one capability manifest so layer ordering/dependencies/copy cannot drift across UI and persistence.
- Reuse one formal/actual-flow edge representation for hierarchy views, pressure propagation, escalation paths, and Composer visualization rather than creating separate graph shapes per screen.
- Centralize module-disabled and permission-denied responses to avoid duplicated JSON/HTML payload shaping across controllers.
- Extract common gate callout rendering (role/handle/gate status) into a shared view helper to keep callouts consistent.
- Introduce shared helpers for follow-type select/datalist rendering to avoid cross-file duplication.
- Consolidate repeated "hash-only guarantee" and verification copy into shared view strings to keep copy consistent.
- Deduplicate topic/stage filter option builders across discussion/petitions to keep filters aligned.
- Share MySQL test env/bootstrap helpers between `tests/ui.test.js` and `tests/external-adapters.test.js` to reduce drift in connection/availability checks.
- Evaluate libp2p (gossipsub + peer discovery) as a resilient transport/ring-identity scaffold alongside HTTP gossip.
- Centralize module-lane definitions (organization operations vs social/community vs civic governance vs federation) so admin, nav, and home summaries cannot drift.

## UX Consistency
- Finish migrating the remaining `callout is-verbose` label/value dumps to the shared context panel (`interfaces/http/views/contextPanel.js`). `/petitions`, `/social`, the `/admin` circle-settings block, `/discussion`, and `/forum` are converted; `auth-eudi.html`'s three-line verifier callout (`hashOnlyMessage`/`policyNote`/`resumeHint`) still flattens facts and guidance into one muted list — fold it into `renderContextPanel` facts/guidance for full consistency.
- `/organization` opens with a full-width marketing hero ("Turn incoming pressure into accountable action") before the inbox, which contradicts the AGENTS UX contract that the route "starts with a familiar inbox and source message". Consider demoting the hero to a compact strip (or `is-verbose`) so the workspace is above the fold.
- Discussion, forum, social, and petition (proposal + deliberation) posts now share the feed head (avatar + `@handle` byline + timestamp). The only remaining `renderAuthorHashLine` author is the argument-map tree node (`petitionView.js`, rendered `tiny`), which is intentionally compact; revisit only if the argument map itself gets a richer layout. Delegation/groups/notifications cards are records/events, not author-attributed posts, so they carry no byline by design.
- Scenario A's social lane now seeds 10 attributed posts, 6 typed follows, and a reshare (`journeySocial` in `scripts/party-journeys.js`), so `/social/feed` is populated and screenshot as `party-social`. Still missing from A2.13: a locked photo (multipart upload) with a view-request notification — add it so the provider-local media path is exercised in the party fixture too.
- `/transactions` and `/extensions` return JSON to browsers even for `Accept: text/html`, so they are API endpoints with page-shaped URLs. Either give them SSR views (docs describe both as catalogs/audit views) or move them under an explicit `/api/` prefix; in-app links now route to `/admin#admin-transactions` and `/admin#extensions` instead.
- `.pressure-case__classification` truncates its voice-type label with an ellipsis (e.g. "FUNDAMENTAL N…") but carries no `title` attribute, so the full value is not discoverable on hover. (The prior, worse bug — inbox cards sizing to their nowrap preview line and overflowing the column so right-aligned timestamps bled into the focused case — is fixed by constraining `.pressure-case-list` to `grid-template-columns: minmax(0, 1fr)` and adding `min-width: 0` to `.pressure-case`.)
- Ship a favicon: every page load logs a 404 for `/favicon.ico` in the browser console.
- Replace the mobile side-navigation height cap with an accessible disclosure or compact horizontal section switcher, preserving keyboard search while putting page content above the fold.
- Add a shared “illustrative data / template preview / persisted workflow” treatment so prototype organization layers can never be mistaken for live delivery, protected intake, financial execution, or pressure analysis.
- Define one cross-module vocabulary for acknowledgement, commitment, consultation, accountable decision, execution, protection, escalation, closure, impact, and recurrence; avoid ambiguous generic “assignee” states.
- Add small-cohort suppression and uncertainty labels to every aggregate pressure visualization before enabling drill-down, preventing protected contributors from being inferred from thin sector/shift slices.
- Standardize gate messaging copy (allowed/blocked + reason) across discussion/social/petitions so callouts read the same.
- Normalize direct-message labeling and handle formatting to keep private-post UX consistent with other sections.
- Keep pill ordering consistent (status, visibility, preview, issuer, timestamp) across all feed cards.
- Every proposal card renders `Topic: general` because `POST /petitions` has no topic field — the debate topic (`liste-attesa`, `consumo-suolo`, `salario-minimo`) is lost when a discussion becomes a proposal, so the Scenario A proposals all read as `general` (visible in `party-proposal`/`party-signatures`/`party-vote`). Carry the source topic through petition creation (or run the classification hook on the proposal body) so proposals inherit their debate topic and breadcrumbs survive.
- Make media lock/report CTA wording consistent between social feed cards and admin review panels.
- Batch or debounce media view-request notifications (per viewer or time window) to avoid alert spam on frequent refreshes.
- Track signing key origin separately from env hydration so `/admin` can report `settings` vs `env` accurately after startup.
- Optionally sync browser-local interface settings (large text, reduced motion, compact nav, partial navigation mode) to provider-local profile/session preferences for cross-device consistency.
- Debounce inline Interface-panel session-default saves and skip no-op `/profile` writes when values have not changed.
- Petition proposals have no topic field, so every proposal renders `Topic: general` and cannot carry the discussion topic it grew out of (e.g. `liste-attesa`). Add an optional topic on `/petitions` (a datalist from the topic registry) so a proposal keeps the breadcrumb of the thread that produced it — the party walkthrough proposal is drafted straight off a `liste-attesa` discussion but the card shows `general`.
- The delegate profile surfaces group **election wins** but never **losses**, so a delegate who lost a group election shows nothing there. `RepresentativeParties.md` §9.3.2 (and SimulationScenarios A8.1) want a lost election visible on the accountability dashboard beside accumulated delegations — the point is precisely that a first-preference leader can lose and the record shows it. Add an "elections contested/lost" line to `renderElectionWins`/`delegateProfiles.js`.
- `applyMemberHiddenSections` (`templates.js`) rescans the fully-assembled SSR body with one regex pass per hidden section key, so a member who hides many sections pays O(keys × body length) per render. Stamp `data-member-hidden` at panel-render time (a template flag like the existing `{{opsHidden}}`, fed from the member's hidden set) or fold the keys into a single alternation, so section-hiding does not re-scan the whole page per key.
- Self-host a variable font (Inter / Space Grotesk / Geist) under `/public` to match the reference "modern" typography exactly while preserving the no-external-request posture; the type stack is currently system/Inter fallback only.
- Roll the reference-modern card/feed structure out from the home/social/forum exemplar to the remaining surfaces (organization, petitions, governance, delegation, groups, delegates, profile, admin), tagging each toggleable module panel with `data-composer-section` + `data-section-label` so the member "Sections" control works everywhere. The token/component refresh already reaches them; only the per-surface structure and section tagging remain.

- The `data-composer-section` keys in `profile.html` and `delegates/templates/delegate-profile.html` are rotated one position out of step with the panels they sit on: `profile-summary` wraps the *provider-local attributes* panel, `profile-interface` wraps *session and handle*, `delegate-profile-endorsements` wraps *delegation coverage*, `delegate-profile-delegations` wraps *vote history*, and `delegate-profile-history` wraps *group endorsements*. The member-visible labels are correct (they describe the content), so this is a naming defect rather than a UX one — but the keys are persisted in `person.uiSettings.hiddenSections` and `settings.composer.pageLayouts`, so renaming them needs a migration that rewrites stored keys, or members silently lose their saved hide/layout choices.
- `.pill.stance--support` still hardcodes its own hue offsets (`calc(var(--primary-h) + 24)`) inline rather than resolving a token; the stance palette would read better as `--stance-*` tokens so a deployment can retune debate colours without editing four component rules.
- The contrast audit that verified the light palette lives only in this task's scratch script. Fold a WCAG-AA sweep (both themes, every member route) into `tests/ui.test.js` or `scripts/ui-smoke.js` so a future component colour cannot regress contrast unnoticed; the fixes it caught (avatar disc lightness, accent-tinted chip ink) had all been shipped defects in dark mode.

## Security follow-ups
- `POST /circle/peers` (`registerPeer`) accepts anonymous requests, so anyone reachable can add peers to the gossip set. Peers are "hints, not trust anchors" by design, but unauthenticated writes to the peer list still deserve an explicit policy decision (admin-only, or signed peer announcements).
- `/transactions` and `/transactions/ledger` are world-readable and expose `actorHash`, digests, and payload topics. Blinded hashes are the intended pseudonym, so this is arguably the transparency goal — but it should be a documented decision with a per-provider toggle rather than an implicit default.
- Internal errors leak raw exception text to clients (`{"error":"internal_error","detail":"error:1E08010C:DECODER routines::unsupported"}`). Log the detail server-side and return an opaque reference id instead.
- Extension install/uninstall dynamically imports modules from `src/modules/extensions/`; now admin-gated, but it deserves an allowlist or signature check before any remote/registry install path is added.
- Consider CSRF protection for the state-changing form posts now that `/admin` is authenticated by a cookie session.

- Neither `scripts/ui-smoke.js` nor `scripts/ui-composer-smoke.js` runs in `npm test`, which is why both drifted into permanent failure unnoticed. Either wire them into the suite (they already build their own ephemeral memory server) or have CI run them, so a nav rename or a route-behaviour change fails loudly instead of rotting.
- `scripts/ui-smoke.js` still matches several nav items by display label; prefer the stable `data-composer-key`/`key` identifiers everywhere so copy changes cannot silently weaken an assertion.

## Observability
- Surface signing-key health beyond "loaded/missing": a key that parses but cannot sign (wrong type, bad curve) should be reported in `/admin` and `/health` rather than failing at first use.
- Add timing metrics for persistence calls and gossip sync to surface slow paths in `/health`.
- Track outbound notification delivery stats per channel and show aggregates in `/admin`.
- Track organization response-boundary misses, acknowledgement latency, unowned commitments, pressure persistence, recurrence after closure, and relief displacement by sector—without actor-level performance ranking.
- Extend the scenario journey harnesses into the causal replay contract in `principle-docs/SimulationScenarios.md`: fresh store, deterministic per-agent manifests, one isolated session and interaction per child event, virtual-clock events, before/after assertions, and a machine-readable trace. Page inactive agent contexts out to bounded session snapshots so the 250-person quorum cohort remains CI-affordable without sharing identity or bulk-seeding state.

## Storage & IO
- Store organization case extensions in module-owned collections created lazily (`commitments`, `flowEdges`, `authorityGrants`, `funds`, `sectorLinks`, `mediation`, `pressureObservations`, `impactReviews`) while keeping the source message and minimal case envelope canonical.
- Separate protected identity/relay mappings and mediation evidence from general case storage with stricter retention, access logging, export, and deletion policies; never include them in ordinary gossip snapshots.
- Move to incremental snapshotting for large JSON stores to reduce write amplification.
- Add compaction or rotation for transactions and notifications to avoid unbounded JSON growth.
- Centralize schema/table definitions across adapters and create module-owned tables/collections (defined inside modules) lazily only when modules are enabled.
- Distribute ring key sets once per epoch and reference by ringId in envelopes to avoid repeating large key lists.
- Stream JSON parsing for ActivityPub/petitions and allow per-endpoint body limits to avoid buffering large payloads in memory.
- Persist gossip skip-cache state (pull + push) in settings to keep skip hints across restarts and avoid warm-up retries.
- Pilot libp2p gossipsub channels for social-lane event replication (with bounded replay + signature checks) to reduce HTTP gossip overhead on high-churn feeds.

## Completed
- Repaired two dev smoke scripts that had silently gone stale against the running UI (both already failing on `main`): `scripts/ui-smoke.js` still asserted that `/` redirects a verified session to `/social/feed`, which was deliberately removed when home became an operational workspace, and `scripts/ui-composer-smoke.js` asserted the pre-rename nav labels ("Wall"). The composer script now finds the side-nav group by its stable `data-composer-key` instead of its display text, which is what let the rename degrade the assertion into an empty list rather than a failure.
- Shipped the light and system themes: `:root[data-theme="light"]` re-declares only the neutral/status/overlay token block (the accent engine still derives from `--primary-h`, so every accent preset works in both), and `system` is resolved by a `prefers-color-scheme` media query rather than JavaScript so it holds on the first paint and with JS disabled. `color-scheme` is declared per theme so native widgets match.
- Tokenized the ~150 theme-blind `rgba()`/hex literals component CSS still carried — hairlines, recessed wells and popover backdrops, the mint marker, one-off status oranges, code surfaces, and on-accent ink — into HSL channel triplets so a rule keeps its own alpha while the theme owns the colour. Verified lossless: every migrated family resolves to the exact rgba() it replaced, and a selector-keyed computed-style diff across 12 routes showed dark mode unchanged except for deliberate fixes.
- Audited every member-facing route in both themes against WCAG AA and cleared it, fixing three pre-existing dark-mode failures on the way: avatar discs (62%→66% lightness — blue hues sat at 4.08:1), the `stance--question`/`--neutral` chips (3.5:1, now on a new `--primary-ink` token for text on accent-tinted fills), and the `stance--proposal` chip, which was pinned to a fixed violet and stopped matching once a member repicked their accent.
- Emitted the appearance vocabulary from one source: the layout ships `interfaceVocabulary()` on `data-ui-vocabulary` and `app.js` reads it, so the browser's accent/density/theme key lists can no longer drift from `interfaceSettings.js`.
- Labeled every chrome-bearing section panel with `data-section-label` (36 of them) so the member "Sections" control reads as a control rather than page copy, and tagged the previously untagged `notifications-preferences` panel, which is rendered from a controller string rather than a template.
- Excluded the Composer's synthesized `panel-N` keys from the member "Sections" list. They are index-derived, so they shift when a page changes shape, and the server never sees them — hiding one had no SSR effect and could move to a different panel on the next render.
- Refreshed the shared theme to a calmer, content-first dark system (surface tokens instead of neon glow), compacted the topbar brand block, slimmed the operator status strip, and converted the context-panel facts dump into a quiet inline chip row — every page now leads with content instead of chrome. See [principle-docs/UIReview.md](principle-docs/UIReview.md).
- Gave discussion/forum/social/People a real feed identity treatment: `renderActorAvatar` colour-keyed initial discs, `@handle` bylines at the card head, and coloured stance chips; suppressed the noisy `from local-circle` provenance pill on locally-authored content; made `formatTimestamp` deterministic `dd/mm/yyyy`; and added the missing `.list-row` styling so the People directory renders as an aligned people list.
- Added session index helpers for handle/pidHash lookup and invalidation on session updates.
- Added `countVisibleEntries()` and switched status/home counts to use it.
- Added in-memory counters for module-disabled requests and rate-limit hits, surfaced in `/admin` and `/health`.
- Added MySQL and MongoDB persistence adapters for larger datasets and provider-managed indexing/backups.
- Added shared timestamp formatting to keep date rendering consistent across controllers and views.
- Added topic breadcrumb caching in discussion/petition/forum lists and reduced social feed passes when filtering posts.
- Centralized the module settings map in module metadata so admin toggles and settings links stay aligned.
- Indexed HTTP routes by method/path to avoid scanning the full route table on every request.
- Combined social follow stats (counts + map) in a single pass and reused follow-type lists for select/datalist rendering.
- Added a shared empty-state renderer for list views to reduce duplicated markup and keep copy consistent.
- Aligned forum header metadata with the callout styling used across other modules.
- Grouped forum threads and comments in a single pass to avoid repeated filtering on large thread lists.
- Rendered gate reason callout rows only when present to remove blank lines across modules.
- Reused a shared `Intl.DateTimeFormat` instance to reduce locale formatting overhead in list renders.
- Streamed multipart uploads to temporary files to avoid buffering large media uploads in memory.
- Added multipart text-field size guards to avoid oversized form memory spikes.
- Added startup cleanup for stale temp uploads left behind by crashes or aborted requests.
- Enforced per-request multipart field byte totals and field count caps to avoid many small fields bypassing per-field limits.
- Added periodic cleanup for stale temp uploads in long-running servers.
- Added multipart field-name and header size caps to reduce oversized multipart metadata.
- Added multipart filename length caps to block oversized upload metadata.
- Persisted upload cleanup stats in settings so `/health` survives restarts and dashboards can trend them.
- Centralized preview-pill rendering in shared view helpers for consistent UX copy.
- Reused a shared `formatBytes()` helper for admin and social media rendering.
- Combined petition comment argument/last-activity scans into a single summary pass.
- Centralized evidence-link rendering across discussion/petition views for consistent output.
- Indexed ActivityPub object/activity ids to avoid scanning `state.socialPosts` during duplicate detection.
- Persisted ActivityPub object/activity id index snapshots to skip rebuilds on restart.
- Added gzip responses for ledger, vote, and transaction exports when requested.
- Skipped gzip compression for small JSON exports (2KB threshold) to avoid CPU overhead.
- Batched MySQL/MongoDB saveData writes and added adapter drop/close helpers for cleaner test runs.
- Cached provider-blind announcement payloads by `updatedAt` so gossip no longer rebuilds ring/audit snapshots on every sync.
- Stored stable fingerprints for peer capability snapshots to avoid repeated JSON stringify comparisons during gossip ingest.
- Parallelized gossip pull runs across peers instead of pulling sequentially.
- Added a pull-side optional-endpoint skip cache (`/votes/ledger`, `/transactions/ledger`) after module-disabled/optional-endpoint misses to avoid repeated failing probes.
- Surfaced optional-endpoint skip cache summaries in `/admin` and `/health` for replication observability.
- Added an outbound endpoint skip cache (`/circle/gossip`, `/votes/gossip`, `/transactions/gossip`) so repeated push runs avoid retrying peers that currently return module-disabled/gossip-disabled responses.
- Cached peer capability lookups per gossip push tick so payload selection reuses the same snapshot across ledger/votes/transactions routing.
- Auto-collapsed the sticky social composer while scrolling down, keeping wall content visible without hiding manual expand controls.
- Added a top-bar Interface settings panel with browser-local persistence (text scale, motion, compact nav, composer auto-collapse preference, partial-navigation mode) and non-blocking UI toasts for enhanced flows.
- Added side-nav jump filtering with `Ctrl/Cmd+K` and `/` shortcuts for faster practical navigation in large module configurations.
- Added shared `paginate`/`renderPager` helpers and applied SSR pagination (page size 20, query-preserving prev/next) across the discussion, petitions, forum-thread, and social-feed lists so large datasets no longer render in full.
- Wired `renderActorLabel`/`resolveHandleForHash` into the remaining raw-hash spots (proposal discussion-feed widget, petition argument-map nodes, `renderUpdatedMeta`, and freeze `frozenBy`/`updatedBy` lines) so no actor hash renders as bare identity.
- Surfaced human-readable notification titles (`humanizeNotificationType`) so `/notifications` no longer shows raw event types like `petition_created`.
- Themed form controls by element rather than by the `.field` wrapper class, so the vote choice, moderation status, and group policy controls stop falling back to the browser's opaque white default in a dark UI; `tests/control-theming.test.js` asserts by computed style so a control added outside a `.field` is caught.
- Added `scripts/user-journeys.js`, which drives the real member flows (discussion, proposal, sign/quorum, freeze/vote, groups, delegation) through the UI with one browser context per member and asserts the outcome of each step. It is the source of the README walkthrough images, so the docs cannot drift from working behaviour without failing the run.
- Possible: group cards render no `id="group-{id}"` anchor, unlike petitions (`id="petition-{id}"`), so a group cannot be deep-linked or referenced from home/activity items the way a proposal can. Adding the anchor would let group activity link back to its card.
- Possible: `triggerDeepLink()` re-arms on every partial navigation and its 250ms `setTimeout` is never cleared, so a member who leaves `/auth/eudi` within that window still gets sent to the wallet deep link from an unrelated page. Cancel the pending timer on navigation, or only arm it while the offer is on screen.
- Possible: the `/profile` handle field is pre-filled with the persisted synthesized fallback (`user-demo-abc`), so a member who clicks into it and types without clearing claims a concatenated handle (`nadiauser-demo-abc`) with no warning. Consider using the fallback as a placeholder, or selecting the field contents on focus.
- Possible: the remaining `callout is-verbose` label/value dumps (discussion, forum, auth) still read like debug output; `renderContextPanel` now covers petitions/social/admin and could absorb them.
- Possible: `organizationTemplate.js` still ships the pressure-state physics metaphor (`Gas`/`Liquid`/`Solid`) that `principle-docs/OrganizationPressureManagement.md` renamed to `Diffuse`/`Flowing`/`Crystallized`, and has no `Critical` state at all. The doc's non-goals name "treating metaphorical pressure physics as scientific proof" as a thing to avoid, so the code currently contradicts its own principle doc; `Critical` is also the state that should route to emergency command with recorded bypass and later review. Rename when replacing the template cases (`pressureType` values Acute/Chronic/Oscillating/Cascade stay — the doc keeps those as case descriptors).
- Possible: `/organization` renders entirely from the hardcoded `ORGANIZATION_TEMPLATE_CASES` constant (no persistence, no write path; only `?case=<id>` and layer tab switching). Replacing its four generic care-cooperative cases with the ASL Val Sereno cases B-1..B-4 in `principle-docs/SimulationScenarios.md` would make the reference workspace show a recognisable organization instead of placeholder content, without needing the persistence layer first.
- Possible: `/discussion` is flat — no reply route exists (forum has `/forum/comment` with `parentId`, social has `/social/reply` with `replyTo`), so an acknowledgement cannot thread under the signal it answers. Scenario B (`principle-docs/SimulationScenarios.md`, B1.4) uses the discussion lane as a shared inbox and makes the gap visible; threading (or a reply-to reference) would let acknowledgements and corroborating signals attach to their source message, which is also what case promotion will need.
- Possible: mention notifications fire only in the social lane (`social_mention` via `src/modules/social/notifications.js`); a `@handle` mention in a discussion post or petition comment notifies nobody. Cross-lane inconsistency — the notification renderer is already shared, only the trigger is missing (SimulationScenarios A2.12 documents the gap and carries the assertion to add once fixed).
