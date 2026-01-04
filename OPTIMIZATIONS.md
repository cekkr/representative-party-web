# Future Optimizations

This file tracks follow-up ideas that are out of scope for the current patch but would further improve performance, reduce redundancy, or tighten UX consistency.

## Performance
- Add pagination/cursors for discussion, petitions, and social feeds to avoid full list rendering on large datasets.
- Maintain optional maps for frequently accessed collections (posts/media/petitions) to avoid repeated `Array.find` calls in hot paths.
- Cache normalized topic keys in entries to avoid repeated normalization and filtering in topic views.
- Add write-behind queues for persistence to batch JSON writes during bursty activity (discussion/posts/comments).
- Add request-scoped memoization for common lookups (policy, actor labels, person/session) inside controllers.
- Track incremental counts in state (discussions/petitions/groups) to avoid full scans when only counts are needed.
- Add bounded list windows (e.g., keep latest N for discussions/social) with optional archive paging to limit memory growth.

## Redundancy
- Centralize module-disabled and permission-denied responses to avoid duplicated JSON/HTML payload shaping across controllers.
- Extract common gate callout rendering (role/handle/gate status) into a shared view helper to keep callouts consistent.
- Introduce shared helpers for follow-type select/datalist rendering to avoid cross-file duplication.
- Consolidate repeated "hash-only guarantee" and verification copy into shared view strings to keep copy consistent.
- Deduplicate topic/stage filter option builders across discussion/petitions to keep filters aligned.

## UX Consistency
- Standardize gate messaging copy (allowed/blocked + reason) across discussion/social/petitions so callouts read the same.
- Align empty-state text tone and structure across discussion/social/forum/petitions.
- Normalize direct-message labeling and handle formatting to keep private-post UX consistent with other sections.
- Keep pill ordering consistent (status, visibility, preview, issuer, timestamp) across all feed cards.
- Make media lock/report CTA wording consistent between social feed cards and admin review panels.

## Observability
- Add structured counters for rate-limit hits and module-disabled requests to surface in `/admin` and `/health`.
- Add timing metrics for persistence calls and gossip sync to surface slow paths in `/health`.
- Track outbound notification delivery stats per channel and show aggregates in `/admin`.

## Storage & IO
- Move to incremental snapshotting for large JSON stores to reduce write amplification.
- Add compaction or rotation for transactions and notifications to avoid unbounded JSON growth.
- Support gzip for ledger/transactions exports to reduce bandwidth usage.

## Completed
- Added session index helpers for handle/pidHash lookup and invalidation on session updates.
- Added `countVisibleEntries()` and switched status/home counts to use it.
