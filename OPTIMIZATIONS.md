# Future Optimizations

This file tracks follow-up ideas that are out of scope for the current patch but would further improve performance, reduce redundancy, or tighten UX consistency.

## Performance
- Add pagination/cursors for discussion, petitions, and social feeds to avoid full list rendering on large datasets.
- Maintain optional maps for frequently accessed collections (posts/media/petitions) to avoid repeated `Array.find` calls in hot paths.
- Cache normalized topic keys in entries to avoid repeated normalization and filtering in topic views.

## Redundancy
- Centralize module-disabled and permission-denied responses to avoid duplicated JSON/HTML payload shaping across controllers.
- Extract common gate callout rendering (role/handle/gate status) into a shared view helper to keep callouts consistent.
- Introduce shared helpers for follow-type select/datalist rendering to avoid cross-file duplication.

## UX Consistency
- Standardize gate messaging copy (allowed/blocked + reason) across discussion/social/petitions so callouts read the same.
- Align empty-state text tone and structure across discussion/social/forum/petitions.
- Normalize direct-message labeling and handle formatting to keep private-post UX consistent with other sections.

## Observability
- Add structured counters for rate-limit hits and module-disabled requests to surface in `/admin` and `/health`.

## Completed
- Added session index helpers for handle/pidHash lookup and invalidation on session updates.
- Added `countVisibleEntries()` and switched status/home counts to use it.
