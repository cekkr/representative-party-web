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
- Replace the mobile side-navigation height cap with an accessible disclosure or compact horizontal section switcher, preserving keyboard search while putting page content above the fold.
- Add a shared “illustrative data / template preview / persisted workflow” treatment so prototype organization layers can never be mistaken for live delivery, protected intake, financial execution, or pressure analysis.
- Define one cross-module vocabulary for acknowledgement, commitment, consultation, accountable decision, execution, protection, escalation, closure, impact, and recurrence; avoid ambiguous generic “assignee” states.
- Add small-cohort suppression and uncertainty labels to every aggregate pressure visualization before enabling drill-down, preventing protected contributors from being inferred from thin sector/shift slices.
- Standardize gate messaging copy (allowed/blocked + reason) across discussion/social/petitions so callouts read the same.
- Normalize direct-message labeling and handle formatting to keep private-post UX consistent with other sections.
- Keep pill ordering consistent (status, visibility, preview, issuer, timestamp) across all feed cards.
- Make media lock/report CTA wording consistent between social feed cards and admin review panels.
- Batch or debounce media view-request notifications (per viewer or time window) to avoid alert spam on frequent refreshes.
- Track signing key origin separately from env hydration so `/admin` can report `settings` vs `env` accurately after startup.
- Optionally sync browser-local interface settings (large text, reduced motion, compact nav, partial navigation mode) to provider-local profile/session preferences for cross-device consistency.
- Debounce inline Interface-panel session-default saves and skip no-op `/profile` writes when values have not changed.

## Observability
- Add timing metrics for persistence calls and gossip sync to surface slow paths in `/health`.
- Track outbound notification delivery stats per channel and show aggregates in `/admin`.
- Track organization response-boundary misses, acknowledgement latency, unowned commitments, pressure persistence, recurrence after closure, and relief displacement by sector—without actor-level performance ranking.

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
