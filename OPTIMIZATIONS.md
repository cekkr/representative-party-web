# Future Optimizations

This file tracks follow-up ideas that are out of scope for the current patch but would further improve performance, reduce redundancy, or tighten UX consistency.

## Performance
- Add pagination/cursors for discussion, petitions, and social feeds to avoid full list rendering on large datasets.
- Cache rendered navigation links keyed by module settings to avoid rebuilding nav HTML on every request.
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
- Cache ring public key sets per ringId and memoize ring signature verification results to reduce repeated verification during gossip syncs.
- Normalize and pre-parse ring public keys when saving provider-blind settings to avoid per-verify PEM normalization work.
- Cache provider-blind announcement payloads (ring + audit snapshots) and rebuild only when settings change to reduce per-gossip normalization work.
- Maintain follower/following adjacency maps keyed by hash to avoid scanning `state.socialFollows` for feed and relationship lookups.
- Store a stable fingerprint for peer capability snapshots to avoid repeated JSON stringify comparisons on every gossip ingest.
- Maintain ActivityPub objectId/activityId indexes for inbound notes to avoid scanning `state.socialPosts` in duplicate detection.

## Redundancy
- Centralize module-disabled and permission-denied responses to avoid duplicated JSON/HTML payload shaping across controllers.
- Extract common gate callout rendering (role/handle/gate status) into a shared view helper to keep callouts consistent.
- Introduce shared helpers for follow-type select/datalist rendering to avoid cross-file duplication.
- Consolidate repeated "hash-only guarantee" and verification copy into shared view strings to keep copy consistent.
- Deduplicate topic/stage filter option builders across discussion/petitions to keep filters aligned.
- Evaluate libp2p (gossipsub + peer discovery) as a resilient transport/ring-identity scaffold alongside HTTP gossip.

## UX Consistency
- Standardize gate messaging copy (allowed/blocked + reason) across discussion/social/petitions so callouts read the same.
- Normalize direct-message labeling and handle formatting to keep private-post UX consistent with other sections.
- Keep pill ordering consistent (status, visibility, preview, issuer, timestamp) across all feed cards.
- Make media lock/report CTA wording consistent between social feed cards and admin review panels.
- Batch or debounce media view-request notifications (per viewer or time window) to avoid alert spam on frequent refreshes.
- Track signing key origin separately from env hydration so `/admin` can report `settings` vs `env` accurately after startup.

## Observability
- Add timing metrics for persistence calls and gossip sync to surface slow paths in `/health`.
- Track outbound notification delivery stats per channel and show aggregates in `/admin`.
- Persist upload cleanup stats (last run counts + errors) in settings/metrics so `/health` survives restarts and dashboards can trend them.

## Storage & IO
- Move to incremental snapshotting for large JSON stores to reduce write amplification.
- Add compaction or rotation for transactions and notifications to avoid unbounded JSON growth.
- Support gzip for ledger/transactions exports to reduce bandwidth usage.
- Centralize schema/table definitions across adapters and create module-owned tables/collections (defined inside modules) lazily only when modules are enabled.
- Distribute ring key sets once per epoch and reference by ringId in envelopes to avoid repeating large key lists.
- Limit multipart filename length to avoid oversized metadata headers.
- Stream JSON parsing for ActivityPub/petitions and allow per-endpoint body limits to avoid buffering large payloads in memory.

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
- Centralized preview-pill rendering in shared view helpers for consistent UX copy.
- Reused a shared `formatBytes()` helper for admin and social media rendering.
- Combined petition comment argument/last-activity scans into a single summary pass.
