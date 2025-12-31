This file captures the essential implementation directives. Keep it in sync with README.md and ROADMAP.md. The core philosophy lives in principle-docs/RepresentativeParties.md (One Person = One Voice, soft-power accountability, liquid delegation, phygital inclusion). Use **user** as the default actor for general-purpose deployments; **person** is a contextual label for civic/party Circles and implies a verified natural person (the exclusion principle: no org/bot/service accounts can hold handles or act in flows).

## Concept anchors
- User vocabulary & exclusion principle: base treats participants as users; when a Circle opts into civic/party mode, “person” means a verified natural person. Org/bot/service accounts are excluded through policy gates, verification, and the banned flag.
- Messaging-first kernel: start as a simple threaded messaging surface (discussion/forum + notifications). Law proposals (petitions), votes, delegation, federation, and topic gardener stay modular toggles/extensions so existing orgs can adopt incrementally without reshaping their structure.
- Parallel social feed & follows: add a Twitter-like follow graph with typed edges (circle/interest/info/alerts) to drive a “small talk + info” micro-post lane. Short posts support replies, mentions/tags, and lightweight reshares; defaults keep it conversational and non-binding so petitions/votes stay distinct.
- Privacy-first identity: store only blinded hashes from EUDI/OIDC4VP flows; never retain raw PID.
- Circle policy: verification is required by default; enforcement can be toggled per Circle but must be observable (providers can run solo messaging networks or join a Circle).
- Federation resilience: peers exchange ledger hashes and audit each other to quarantine toxic providers; gossip ingest rejects policy id/version mismatches and tracks peer health/quarantine; when multiple providers belong to the same social-party ring, they should also prefer a shared client (or compatible clients) to keep UX and enforcement aligned across that ring.
- Session handles/roles: verified sessions persist a handle + role (user/person/moderator/delegate) and a banned flag so policy gates can block actions transparently and keep non-people out.
- Personalizable structure manager: keep a minimal canonical profile (handle, required credential/wallet binding, role/banned flag, blinded hash) consistent across a party ring while letting providers attach dynamic fields (contact email, personal details, notification preferences, etc.) through a schema/data-table editor. Required fields stay enforced globally; provider-only fields remain local (no gossip) and the provider is responsible for consent and delivery (e.g., notification emails/SMS).
- Human-ready baseline: keep modules small, env-driven, and documented so teams can ship/maintain without AI assistance if needed.
- Extensions: optional modules under `src/modules/extensions/` (enabled via `CIRCLE_EXTENSIONS`) can extend policy/action gates and decorate decisions without changing core code; use them to align with organizational policies instead of forking.
- Module toggles: core modules (petitions/votes/delegation/groups/federation/topic gardener/social) are admin-configurable; navigation/endpoints must respect disabled modules, returning a module-disabled page or 403 JSON.
- Dynamic topics & delegation scaffolds: topic classification hooks via extensions; delegation preferences persisted per topic with auto vote resolution + override.
- Topic stewardship & gardening: users (people in civic Circles) pick top categories; admins/policy voters can pin mandatory anchors (legal/departmental). An automatic gardener (see principle-docs/DynamicTopicCategorization.md) merges/splits/renames to surface trends, pull isolated clusters toward main topics, and keep discussions aggregated.
- Notification registry: internal notifications persisted to JSON with basic read/unread handling; provider-local preferences can opt in/out of proposal comment alerts.
- Forum & groups: forum threads/articles with comments tied to topics; groups offer delegation cachets with per-topic priorities and conflict surfacing.
- Group roles & elections: groups persist member roles and can set delegate election/conflict policies separate from Party Circle policy (priority vs vote, conflict prompt vs auto).
- Group delegate elections: ballots per topic with votes/tally; winners auto-set as delegates per group policy; ballots store optional second/third-choice picks with multi-round transfers for person elections (Alaska-style). When electionMode=vote, delegation recommendations should prefer the latest closed election winner.
- Recommendations are advisory: group cachets and any delegation recommendations must stay non-binding; users/people can always override with their own choice per topic.
- Vote envelopes & anti-injection: votes are signed envelopes (issuer + policy + petitionId + authorHash + choice); `/votes/ledger` exports them; `/votes/gossip` ingests signed envelopes to prevent injected/replayed votes across providers.

## Data topology & adapters (central + p2p)
- Central vs p2p is not feature creep: the codebase must stay storage-agnostic so providers and Circles can choose centralized storage, p2p-first, or hybrid redundancy/validation without forking domain logic.
- Data management priorities: provider-local contact/profile fields never gossip; previews are gated by `DATA_PREVIEW` + validation level; redundancy is selected via `DATA_MODE` (centralized/hybrid/p2p) + adapter; signatures/validation status decide what can render or replicate.
- Main transactions registry: append-only log of sensitive operations (votes, petition drafts/status changes/signatures/comments, delegation overrides) with digest + issuer/mode/adapter, stored locally per provider (`transactions` store) for audit and cross-provider validation against signed envelopes; signed summary envelopes can be exported and gossiped (`/transactions/ledger`, `/transactions/gossip`) for reconciliation.
- Transactions coverage: discussion/forum/social/group actions emit transactions so audit trails match user-facing activity feeds; admin UI surfaces recent entries plus export links.
- Structure manager + schema editor: canonical tables/fields (sessions, handles, roles/banned, blinded PID or credential binding) stay fixed; provider-defined optional fields/tables are registered through a structure manager with an admin UI data-table editor, persisted via adapters with versioned metadata. Provider-only fields (contact email/personal info) never gossip; providers own notification delivery/consent that relies on those fields.
- Split persistence/transport into adapters: `src/infra/persistence/storage.js` remains the interface; adapter drivers live under `src/infra/persistence/adapters/{json,sql,kv}` and replication/validation helpers under `src/modules/federation/replication.js` (gossip fetch + signature/ban checks) so domain modules call a single abstraction. SQL uses SQLite (optional `sqlite3`, file path via `DATA_SQLITE_URL|FILE`), KV is file-backed; JSON/memory are defaults.
- Keep preview vs certified states explicit: adapters return `status: preview|validated` with provenance; UI and shared clients (especially within the same social/party ring) must avoid rendering uncertified data where policy forbids it, and clearly label previews when allowed.
- Settings drive combinations instead of code forks: `DATA_MODE=centralized` (single adapter, no gossip), `DATA_MODE=hybrid` (central canonical + p2p replicas/merkle audit), `DATA_MODE=p2p` (gossip-ledger primary with optional local cache); `DATA_VALIDATION_LEVEL` and `DATA_PREVIEW` toggles gate when previews are stored/surfaced.
- Gossip gating: when `DATA_MODE=centralized`, gossip ingest is disabled (403) to prevent unintended replication; `hybrid` and `p2p` keep gossip enabled.
- Roadmap alignment: Phase 1 delivers adapterized interfaces + JSON driver and stub gossip validator; Phase 2 adds SQL/kv drivers and hybrid mode wiring; Phase 4 hardens replication (quarantine, redundancy targets, cross-ring audits).

## Code map (Phase 1 kernel)
- **Entry & server**: `src/index.js` (bootstrap), `src/app/server.js` (HTTP), `src/app/router.js` (table-driven routes).
- **Interfaces (HTTP)**: `src/interfaces/http/controllers/` (`home`, `health`, `auth`, `discussion`, `forum`, `petitions`, `notifications`, `groups`, `delegation`, `circle`, `extensions`, `activitypub`, `static`, `admin`, `votes`, `social` for follows/feed/posts); view helpers in `src/interfaces/http/views/`.
- **Domain modules**: `src/modules/identity/*` (auth scaffold + blinded hash, person session lookup, privileges), `src/modules/circle/*` (policy gates, ledger envelope signing/verification), `src/modules/messaging/notifications.js`, `src/modules/topics/*` (classification hook + topic gardener client), `src/modules/petitions/signatures.js`, `src/modules/votes/voteEnvelope.js`, `src/modules/delegation/delegation.js`, `src/modules/groups/*` (delegation cachets, per-group rules, elections), `src/modules/social/*` (follow graph + micro-posts + mentions/tags/reshares), `src/modules/federation/{activitypub.js,gossip.js,ingest.js,peers.js,quarantine.js}`, `src/modules/extensions/registry.js` + `sample-policy-tighten.js`.
- **State/persistence**: `src/infra/persistence/storage.js` (interface), adapter drivers under `src/infra/persistence/adapters/` (JSON now; SQL/kv planned), replication/validation helpers in `src/modules/federation/replication.js`, migrations in `src/infra/persistence/migrations.js`, and the store entry in `src/infra/persistence/store.js` (social follows + micro-posts persist through the same adapters).
- **Helper services**: AI/ML workers live in `src/infra/workers/` (Python projects, e.g., topic gardener). Node code should call them via `src/modules/topics/topicGardenerClient.js` to avoid conflicting provider outputs and duplicated computation across classification providers.
- **Shared utilities**: `src/shared/utils/` (http helpers, request parsing, text sanitization/escaping).
- **Assets**: `src/public/` (templates, CSS, JS). Static served from `/public/*`.

## UX contract (Phase 1)
- SSR-first with partial HTML responses when `X-Requested-With: partial` is set by the vanilla router.
- Auth flow must always surface: QR + deep link, hash-only guarantee, and session recovery/error states.
- Layout must show Circle policy flag, verified handle when present, ledger/actor/discussion counts for accountability cues, and gossip ingest state.
- UI copy should use “user” vs “person” labels based on Circle enforcement (person only when civic/party mode is strict).
- Discussion sandbox: identity-aware posting, no CAPTCHA; copy explains accountability via blinded PID hash.
- Proposal hub: proposal list includes discussion counts and a discussion feed with stage filters to surface active deliberations.
- Delegation UI: group recommendations show election-winner metadata so users can see why a suggestion was picked.

## Endpoints
- `/` landing, `/health` metrics, `/auth/eudi` start, `/auth/callback` verifier return, `/discussion` (GET/POST), `/circle/gossip`, `/circle/ledger`, `/circle/peers`, `/ap/actors/{hash}`, `/ap/actors/{hash}/outbox`, `/ap/outbox`, `/ap/inbox`, `/public/*`.
- `/social/feed` (GET) renders the micro-post timeline for the signed-in user based on typed follows; `/social/post` (POST) publishes a short post; `/social/reply` (POST) replies inline; `/social/follow` + `/social/unfollow` set typed follow edges; `/social/relationships` lists follow edges for a handle.
- `/petitions` (GET/POST) drafts proposals with summary + optional full text; quorum moves proposals into discussion, `/petitions/status` advances to vote/closed; `/petitions/comment` posts discussion notes; `/petitions/vote` casts votes; `/petitions/sign` handles signatures/quorum; gates enforce per-role policy.
- `/extensions` (GET/POST) to list and toggle extension modules without env changes.
- `/notifications` (GET) list internal notifications; `/notifications/read` marks all read; `/notifications/preferences` stores per-user alert toggles (proposal comments).
- `/forum` (GET/POST) publish articles; `/forum/comment` post comments.
- `/groups` (GET/POST) list/create/join groups; `/groups/delegate` set group-level preferred delegates.
- `/delegation` (GET/POST) manage manual delegation preferences; `/delegation/conflict` resolve delegation conflicts by user choice.
- `/groups` actions also start/close/vote delegate elections per topic.
- `/transactions` (GET) list recent local transactions; `/transactions/export` emits a signed summary envelope; `/transactions/ledger` serves summaries for peers; `/transactions/gossip` ingests summaries for reconciliation.

## Near-term implementation focus
- Ship the messaging-first social network first: bind verified user sessions to handles/profiles (person is a Circle-specific, natural-person guarantee), model privileges (author/mod/delegate) and Circle policy enforcement for posting/petition/vote.
- Parallel social feed: deliver typed follow edges (circle/interest/info/alerts) and a micro-post lane (short text + optional link/attachments) with replies/mentions/reshares. Keep UX copy explicit that this lane is for small talk/info; petitions/votes/forum stay the authoritative tracks.
- Adoption path: keep messaging + notifications usable alone; petitions/votes/delegation/federation/topic gardener stay optional so orgs can layer capabilities as staff and policy mature.
- Personalizable structure manager: lock the canonical fields (handle, blinded identity/credential binding, role/banned flag) and expose a provider-local schema/data-table editor for optional fields (contact email, personal info, notification preferences). Provider-only fields never leave the provider; the provider owns consent flows and outbound notifications that rely on them.
- Model and validate data exchanges end-to-end: persisted discussions/petitions/votes with author-session binding, rate limits, quorum/ban checks, delegation edges, and audit trails that surface in the UI.
- Harden persistence via a pluggable store abstraction (JSON now, DB later) with basic migrations so user/discussion/vote data is durable.
- Keep identity foundations minimal but real: OIDC4VP/OpenID hash validation, key management, and QR/deep-link UX; deeper protocol polish waits until user/data flows work.
- Federation kept to stubs while local UX ships: lightweight inbox/outbox + ledger gossip placeholders to avoid blocking; spec-level details follow once the network is usable (see ROADMAP.md).
- Testing: run `npm test` for the node:test suite (hashing, migrations, module toggles, Circle policy gates, Puppeteer UI role flows, ring gossip consistency); `npm run test:ui` is the stable UI-only entry point.
- Ops knobs: `/admin` now includes session overrides (role/ban/handle) to exercise gates without editing JSON; extensions can be toggled via `CIRCLE_EXTENSIONS`.
- Ops cues: `/admin` surfaces ledger hash, gossip ingest state, outbound/inbound gossip sync status, peer health reset actions, and recent transactions for audit snapshots; `/health` includes peer health summaries plus vote/transactions gossip added/updated counts for ops dashboards.
- Petition/vote scaffold: proposals persisted to JSON with per-role gating, discussion notes, quorum → discussion (or admin-configured vote), and vote tallies; UI surfaces gate errors per role.
- Extension manifest: `/extensions` surfaces available modules + metadata; toggles persist to settings, reloading extensions at runtime.
- Module toggles: `/admin` lets operators disable optional modules (petitions/votes/delegation/groups/federation/topic gardener/social) for messaging-only deployments; navigation and endpoints honor the settings to avoid dead ends.
- Topic/delegation prep: classification hook + delegation store support dynamic topic models and cross-provider delegation logic; votes support auto delegation with manual override.
- Notification base: notifications persisted to JSON, scoped to verified users (people in civic Circles), exposed via `/notifications` with per-user preferences for proposal comment alerts.
- Topic gardener helper: build DynamicTopicCategorization as a Python helper in `src/infra/workers/topic-gardener/` (online ingestion + scheduled refactor) with a stable API consumed by `src/modules/topics/classification.js`. Respect user/person-picked top categories and admin/policy anchors; reconcile provider outputs to avoid conflicting labels and redundant processing. A stub HTTP helper sits in `src/infra/workers/topic-gardener/server.py`; anchors/pins + optional URL are configurable via `/admin`.
- Forum/groups: long-form articles + comments per topic; groups can publish delegation cachets with per-topic priorities and conflict notification; membership drives recommendations for auto-delegation.
- Group policy separation: Party Circle policy governs quorum/voting; groups manage internal delegate election/conflict rules (defaults inherit admin settings); provider policy remains about data/validation.
- Group elections: ballots per topic; group policy decides priority vs vote; conflict UI lets users/people pick delegates when suggestions clash.

## Possible next steps:
- Add module-aware UI tests (Puppeteer) to validate nav visibility and disabled endpoint UX.
