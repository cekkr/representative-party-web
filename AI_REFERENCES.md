This file captures the essential implementation directives. Keep it in sync with README.md and ROADMAP.md. The core philosophy lives in principle-docs/RepresentativeParties.md (One Citizen = One Voice, soft-power accountability, liquid delegation, phygital inclusion).

## Concept anchors
- Privacy-first identity: store only blinded hashes from EUDI/OIDC4VP flows; never retain raw PID.
- Circle policy: verification is required by default; enforcement can be toggled per Circle but must be observable.
- Federation resilience: peers exchange ledger hashes and audit each other to quarantine toxic providers.
- Session handles/roles: verified sessions persist a handle + role (citizen/moderator/delegate) and a banned flag so policy gates can block actions transparently.
- Extensions: optional modules under `src/extensions/` (enabled via `CIRCLE_EXTENSIONS`) can extend policy/action gates and decorate decisions without changing core code.
- Dynamic topics & delegation scaffolds: topic classification hooks via extensions; delegation preferences persisted per topic with auto vote resolution + override.
- Notification registry: internal notifications persisted to JSON with basic read/unread handling.
- Forum & groups: forum threads/articles with comments tied to topics; groups offer delegation cachets with per-topic priorities and conflict surfacing.
- Group roles & elections: groups persist member roles and can set delegate election/conflict policies separate from Party Circle policy (priority vs vote, conflict prompt vs auto).

## Code map (Phase 1 kernel)
- **Entry & server**: `src/index.js` (bootstrap), `src/server/bootstrap.js` (HTTP), `src/server/router.js` (routes).
- **Route handlers**: `src/routes/` (`home`, `health`, `auth`, `discussion`, `forum`, `petitions`, `notifications`, `groups`, `delegation`, `circle`, `extensions`, `activitypub`, `static`).
- **Services**: `src/services/` (`auth` for credential offers/blinded hash + cookie, `activitypub` actor factory, `citizen` session lookup, `classification` topic hook, `delegation` auto vote routing + conflict choice, `notifications` registry, `groups` delegation cachets, `groupPolicy` per-group rules).
- **Policy gates**: `src/services/policy.js` resolves effective Circle policy and gates post/petition/vote/moderation per role, surfaced in `/health` and UI.
- **State/persistence**: `src/state/storage.js` (load/persist ledger, sessions, peers, discussions, actors; JSON store with migration-ready interface).
- **Migrations**: `src/state/migrations.js` (schema v3 adds session handles/roles/banned flags; v4 adds petitions/votes scaffolds and persisted extension list; v5 adds delegations/notifications and petition lifecycle defaults).
- **Extensions**: `src/extensions/registry.js` loads optional modules from `src/extensions/*.js` so deployments can extend action rules; sample `sample-policy-tighten.js` demonstrates hook shape.
- **Views/helpers**: `src/views/templates.js` (SSR + partials), `src/views/discussionView.js` (render posts), `src/utils/` (http helpers, request parsing, text sanitization/escaping).
- **Assets**: `src/public/` (templates, CSS, JS). Static served from `/public/*`.

## UX contract (Phase 1)
- SSR-first with partial HTML responses when `X-Requested-With: partial` is set by the vanilla router.
- Auth flow must always surface: QR + deep link, hash-only guarantee, and session recovery/error states.
- Layout must show Circle policy flag, verified handle when present, and ledger/actor/discussion counts for accountability cues.
- Discussion sandbox: identity-aware posting, no CAPTCHA; copy explains accountability via blinded PID hash.

## Endpoints
- `/` landing, `/health` metrics, `/auth/eudi` start, `/auth/callback` verifier return, `/discussion` (GET/POST), `/circle/gossip`, `/circle/ledger`, `/circle/peers`, `/ap/actors/{hash}`, `/ap/inbox`, `/public/*`.
- `/petitions` (GET/POST) scaffold for drafting petitions; `/petitions/vote` to cast votes; `/petitions/sign` for signatures/quorum; gates enforce per-role policy.
- `/extensions` (GET/POST) to list and toggle extension modules without env changes.
- `/notifications` (GET) list internal notifications; `/notifications/read` marks all read.
- `/forum` (GET/POST) publish articles; `/forum/comment` post comments.
- `/groups` (GET/POST) list/create/join groups; `/groups/delegate` set group-level preferred delegates.
- `/delegation/conflict` resolve delegation conflicts by user choice.

## Near-term implementation focus
- Ship the operative social network first: bind verified citizen sessions to handles/profiles, model privileges (author/mod/delegate) and Circle policy enforcement for posting/petition/vote.
- Model and validate data exchanges end-to-end: persisted discussions/petitions/votes with author-session binding, rate limits, quorum/ban checks, delegation edges, and audit trails that surface in the UI.
- Harden persistence via a pluggable store abstraction (JSON now, DB later) with basic migrations so user/discussion/vote data is durable.
- Keep identity foundations minimal but real: OIDC4VP/OpenID hash validation, key management, and QR/deep-link UX; deeper protocol polish waits until user/data flows work.
- Federation kept to stubs while local UX ships: lightweight inbox/outbox + ledger gossip placeholders to avoid blocking; spec-level details follow once the network is usable (see ROADMAP.md).
- Testing: node built-in tests cover hashing, migration normalization, and Circle policy gates so regressions in critical flows surface quickly.
- Ops knobs: `/admin` now includes session overrides (role/ban/handle) to exercise gates without editing JSON; extensions can be toggled via `CIRCLE_EXTENSIONS`.
- Petition/vote scaffold: petitions persisted to JSON with per-role gating and vote tallies; UI surfaces gate errors per role.
- Extension manifest: `/extensions` surfaces available modules + metadata; toggles persist to settings, reloading extensions at runtime.
- Topic/delegation prep: classification hook + delegation store support dynamic topic models and cross-provider delegation logic; votes support auto delegation with manual override.
- Notification base: notifications persisted to JSON, scoped to verified citizens, exposed via `/notifications`.
- Forum/groups: long-form articles + comments per topic; groups can publish delegation cachets with per-topic priorities and conflict notification; membership drives recommendations for auto-delegation.
- Group policy separation: Party Circle policy governs quorum/voting; groups manage internal delegate election/conflict rules; provider policy remains about data/validation.
