> Citizen OS is the design reference for the framework's server-rendered shell, collection pages, focused workspaces, and visual system. The UI roadmap distinguishes current layouts from target HTML and sets acceptance criteria. Keep it in sync when presentation changes. [UI roadmap](UI_ROADMAP.md)

This roadmap defines the general-purpose **Web Organization Framework**. Its communication-first organization model is specified in `principle-docs/OrganizationPressureManagement.md`; the Representative Parties thesis remains an optional civic bundle (`principle-docs/RepresentativeParties.md`). Default actor is a user; “person” is a civic/party Circle label that signals a verified natural person (exclusion principle: org/bot/service accounts cannot hold handles). Near-term priority is familiar communication plus independently adoptable organization layers; deep civic and federation protocol polish follows once users can actually interact.

## Anchoring Principles
- **Communication-first organization**: email/thread intake and notifications work alone. Messages become structured cases only when protected voice, ownership, authority, funds, sectors, mediation, aggregate pressure, or impact learning adds value.
- **Pressure without punishment**: needs, constructive concerns, advice, consultations, and disputes make organizational strain visible. Analytics explain volume, velocity, persistence, spread, consequence, and capacity at aggregate level; they never score personal worth or automatically sanction staff.
- **Permeable hierarchy**: preserve expertise, accountable decisions, and emergency speed while showing formal and actual working flows, direct feedback paths, and contextual escalation.
- **Explicit powers and money**: responsibility, commitments, consultation, decision rights, execution, protection, budget constraints, and reconciliation stay inspectable and distinct. Financial visibility informs participation but does not turn every expense into a vote.
- **Honest protection**: email is attributed; protected voice requires a separate audited path, minimized metadata, explicit reveal policy, and human moderation.
- **One person/person, One Voice** backed by blinded identity; federation guards against double representation and toxic providers. “Person” is a Circle-specific label layered on top of the user role when civic proof is enabled.
- **Exclusion principle**: only natural persons can hold handles or act; org/bot/service accounts are blocked via verification policy and banned flagging.
- **Provider-blind option (optional)**: user ids are Circle-unique independent of provider; explore P2P protocols to obscure provider attribution in gossip/UX where feasible without breaking auditability.
- **Privilege-free Circle genesis (optional)**: Circles can start with no special roles beyond provider admins; governance can emerge via groups, member votes, and contextual dynamic structures.
- **Soft-power accountability**: transparency and auditable trails instead of hard imperative mandates.
- **Liquid representation**: delegation is topic-scoped, revocable, and visible; users/people can migrate without losing history.
- **Phygital inclusion**: the digital platform must remain accessible via desktop/mobile and be mirrored by physical “agorà” touchpoints.
- **Messaging-first adoption**: start with a simple messaging/social layer; petitions/votes/delegation/federation are modular so existing orgs can extend at their own pace.

## Architecture Baseline (Phase 1 kernel)
- **Modular NodeJS monolith**: app entry under `src/app/` (server + table-driven router), HTTP controllers in `src/interfaces/http/controllers/`, domain logic in `src/modules/`, persistence in `src/infra/persistence/`, shared helpers in `src/shared/`, and view helpers in `src/interfaces/http/views/`.
- **Identity & Sessions**: default user sessions with blinded PID hashing; OIDC4VP verifier scaffold (EUDI wallet offer/callback) marks a session as “person” for civic Circles to enforce natural-person guarantees.
- **Personalizable structure manager**: canonical profile fields (handle + credential/wallet binding, role/banned flag, blinded hash) stay fixed across a party ring; provider-local optional fields (contact email, personal info, notification preferences) are modeled via a schema/data-table editor and stored locally to power provider-owned notifications/consent.
- **Persistence**: JSON store (ledger, sessions, peers, discussions, actors) under `src/data/` with pluggable upgrade path.
- **Federation seeds**: ActivityPub actor emitter, outbox plus inbox ingestion (preview-gated), gossip endpoints for peer/ledger sync.
- **Gossip identity**: set a stable issuer URL/identifier (`CIRCLE_ISSUER` or `/admin`) so peers can track envelope provenance.
- **Frontend shell**: SSR templates + vanilla router interceptor (partial HTML) with wallet handoff UI and discussion sandbox.
- **Messaging surface first**: discussion/forum + notifications operate even when petitions/votes/delegation/federation are disabled; policy + extensions decide when to light up advanced modules.
- **Organization workspace** uses `/organization` for live discussion-linked cases and a searchable queue. `/organization?view=preview` illustrates email intake, protected visibility, commitments, hierarchy, authority, funds, sectors, mediation, pressure dynamics, and impact learning.
- **Organization case contract**: the source message stays canonical; optional module-owned records attach by case id and are created lazily. Protected identity mappings, contact metadata, and mediation detail remain provider-local.
- **Module families**: optional modules are grouped as `Organization operations`, `P2P social/community`, `Civic governance`, and `Federation/resilience` so providers can reuse the framework without carrying civic flows by default.
- **Parallel social feed**: typed follows (circle/interest/info/alerts) power a Twitter-like micro-post lane with replies/mentions/tags/reshares and optional provider-local media uploads (locked by default, view-on-request with author notifications, blockable after reports); kept distinct from petitions/votes/forum flows so authority never derives from follows.
- **Helper services**: external AI/ML workers (e.g., the topic gardener) live under `src/infra/workers/` as Python projects, exposed via cohesive APIs so Node callers avoid conflicting classification results and redundant calls.
- **UI coherence**: status strip in layout surfaces Circle enforcement + validation/preview state, ledger/actor/discussion counts, and gossip ingest state; templates stay extension-aware so toggled modules show/hide nav items and reuse shared badges for preview/provenance across discussion/social/petitions.

## Data topology & adapters
- Modes: `DATA_MODE=centralized` (single adapter, no gossip writes/ingest), `DATA_MODE=hybrid` (central canonical + p2p replicas/merkle audit), `DATA_MODE=p2p` (gossip-ledger primary with optional local cache). `DATA_VALIDATION_LEVEL` (`strict` | `observe` | `off`) and `DATA_PREVIEW` (allow/prevent preview storage) gate when uncertified data is stored or surfaced; `DATA_ADAPTER` selects the driver (`json` default, `memory` for ephemeral/local).
- Adapter map: drivers live under `src/infra/persistence/adapters/` with the selector in `src/infra/persistence/store.js`; replication/validation helpers live in `src/modules/federation/replication.js`. Domain modules call the interface, not the concrete adapter. SQLite-backed SQL and file-based KV adapters exist (SQL requires optional `sqlite3`); JSON/memory remain defaults. MySQL and MongoDB adapters are available as optional advanced drivers.
- Future schema optimization: define table/collection schemas once and share them across adapters; some tables/collections are defined directly inside modules and should be created lazily so disabled modules do not create storage artifacts.
- Phase alignment: Phase 1-2 deliver the adapterized interface plus JSON/memory/sql/kv drivers and hybrid-mode wiring; MySQL/MongoDB adapters remain optional advanced drivers; Phase 4 tightens redundancy targets, quarantine, and cross-ring audits.

## UX Baseline (to harden during Phase 1)
- Clear entry points: CTA for “Verify with EU Wallet” and “Start debating” with copy that explains privacy (hash-only, no PII stored) and the natural-person exclusion principle when civic mode is on.
- Deep link / QR duality: desktop shows QR + copyable link; mobile prioritizes direct handoff.
- Accountability cues: show verified handle/person badge, ledger count, and Circle policy status on every page frame.
- Error/edge flows: graceful partial responses for session issues; offline-friendly offer preview and retry CTA.
- Actor labels: UI copy switches between “user” and “person” based on Circle enforcement (person only when civic/party mode is strict).
- Delegation UI: show election-winner metadata next to group recommendations so users understand why a suggestion was picked.
- Accessibility: keyboard-friendly forms, high-contrast defaults, and no client-side blocking for SSR-first paths.
- Progressive organization UX: familiar inbox first, source message always visible, disabled layer previews clearly marked, formal and actual flow compared, pressure components explained, and no personal pressure leaderboard or opaque staff score.

## Adoption & Extension stance
- Start from messaging + notifications as the default value. Organization layers (`protectedVoice`, responsibilities, hierarchies, authority, funds, sectors, mediation, pressure analytics, impact tracking) and civic/federation modules are opt-in so existing organizations can extend without being forced into one operating model. Core module toggles live in `/admin` and gate nav + endpoints.
- Providers can stay standalone or join a social/party Circle; policy gates and extensions keep behavior cohesive inside a provider and across a Circle when shared norms are desired.

## Implementation Roadmap

## Current status snapshot (Phase 1 largely shipped)
- Messaging kernel is live (discussion/forum/notifications) with SSR + partial HTML navigation; discussion notes and forum comments accept optional evidence/citation links.
- Discussion has scoped text and evidence search, hierarchical topic filters, and a focused contribution view linked from the feed and Home. A contribution keeps its address across promotions. The current lane decides access, and the return link preserves the originating search and page.
- Forum has searchable article rows and a focused article URL with chronological replies. Home links directly to the article. Members choose a category when publishing, with classification as the fallback.
- Coordination supports five voice types, consequence, source-derived scope, an attributed acknowledgement, and a review date. Signed-in users with posting access can open one case per eligible discussion post. The source text and evidence render from the discussion record. The case store and its audit events stay on the provider.
- Proposal browse has stage-filtered summary cards. Stable proposal URLs open Overview, Discussion, History, or Ballot under the stored lane read policy. Home, Notifications, and delegate queues link to the record. Notifications page through alerts and withhold proposal details if access changes.
- Social feed ships typed follows plus replies/mentions/tags/reshare and provider-local media uploads (locked by default with view-request notifications, blockable after reports), gated by the same role/ban checks.
- Media uploads now stream to temp files with field-size/field-count guards, field-name/header caps, and startup/periodic cleanup for stale uploads; cleanup stats surface in `/health` and `/admin` and persist in settings for restart-safe ops cues.
- Media uploads enforce filename length caps to prevent oversized multipart metadata.
- Request body limits now cap non-media payloads and reject unexpected multipart forms.
- Circle policy gates, session roles/ban flags, and identity-based rate limits are wired into posting flows.
- Petitions/signatures/votes pipeline exists with vote envelopes, structured proposal outline fields, collaborative revisions + version history, stage cues, evidence summaries + sources, stance-tagged comments + fact-check flags + evidence prompts, argument-map linking, transactions log + gossip summaries, and admin controls.
- Proposal mutations authorize against the stored group lane. Public group lanes allow browsing, while member participation and moderation follow the relevant lane and Circle gates. Group actions return to the resulting lane after the write.
- Delegation, groups, and ranked-choice elections are live. The group directory opens focused Overview, Members, Decisions, and gated Settings views. Lane links respect current visibility and modules, and group writes return to the relevant section.
- Governance defaults (quorum, timing windows, vote method, delegation decay window) are editable in `/admin` and published at `/governance`.
- `/admin` now includes a first-run installation wizard for Circle basics, data mode, peer alignment, and optional defaults.
- `/admin` includes a module control center with toggles plus a settings map and wizard step anchors to keep activation and configuration aligned (links live with module metadata).
- Module control center now groups optional modules by lane (`Organization operations`, `P2P social/community`, `Civic governance`, `Federation/resilience`) and surfaces per-lane enabled summaries for faster non-party deployments.
- Delegate profile views surface delegation counts, vote history, and group endorsements (optional public bio).
- Governance defaults now accept verified-user change proposals from `/governance`; admins approve/reject them in `/admin`, accepted proposals update the constitution defaults, and decisions append governance history plus transaction/audit entries.
- Liquid delegation now resolves transitively: `resolveDelegation` follows a delegate's own per-topic choices to the terminal delegate with cycle detection, a depth cap, and banned-delegate stops; `/delegation` shows an "explain my influence" chain view and delegate profiles expose an advisory deliberation score (trust/participation/deliberation/endorsement with a recency factor) plus a "rising star" cue.
- Delegation decay/renewal is live: an admin-configurable `delegationDecayDays` governance setting (0 = off) lapses un-renewed delegations so they drop out of resolution; `/delegation` shows freshness pills (active/expiring/lapsed) with a per-topic Renew action, and `/governance` surfaces the decay window.
- Delegated ballots now carry real voting power. A delegated vote used to be stored as the opaque string `delegate:<hash>`, which no tally understood — it fell into the abstain bucket and stayed there, so delegation decided nothing. A delegated ballot is now a structured record that resolves at read time through the delegate's own vote, transitively, with the existing cycle/depth guards; `tallyVotes` reports it as the choice the delegate actually made.
- The delegate vote window is live: an admin/community-configurable `delegateVoteWindowDays` governance setting (default 5, 0 = no deadline) gives a delegate that many days to cast a ballot handed to them. A ballot inside its window is reported as **pending** and deliberately not counted as an abstention — doing so would misreport the outcome while the delegate still has time to act; after the window it lapses to abstain. The member can override at any time by voting themselves, which replaces the delegated ballot.
- Both sides of that contract are visible. `/delegation` gained a "Ballots delegated to you" inbox (deadline countdowns, direct links to vote) and a "Votes riding on a delegate" panel with per-ballot status and an override link; `/petitions` states who holds a member's ballot, how long they have, and whether it has been counted, and its vote button reads "Override" once a ballot is delegated. The delegate is notified when a ballot arrives, and the member is notified when their delegate votes.
- Delegation is now topic-hierarchy aware. Matching was exact-string, so a delegation on `environment` silently never applied to a proposal filed under `environment/energy` — the common case, since proposals are classified into nested paths. Resolution now walks the path narrowest-first (`environment/energy` → `energy` → `environment` → `general`), so a parent-category delegation covers its subcategories while a more specific one still wins. The same rule applies to forwarding hops, group cachets, and group elections, so a branch group's subcategory election outranks the parent group's general one.
- The delegate binding (holder, route, deadline) is inside the signed vote envelope, so a peer cannot reassign a ballot or extend its window and still present a valid envelope.
- Groups can nest. A group may be a **branch** of another — a party with a topic-focused think tank, a working wing, or an alternative line — with a depth cap, self/cycle guards, lineage on the card, and a tree-ordered list. Nesting is structural, not authority: a branch does not inherit its parent's membership and is not governed by it. What it buys is discovery, specificity (a branch cachet settles a tie its parent's cannot), and a defined "upper level".
- Groups declare **topic categories**, registered through the same nested topic registry the site uses, so `Energy / Solar` declared by a branch is the same category a delegation can be scoped to. `/groups` gained a **category directory** — "who works on what" — listing each declared category, the groups covering it, and who each currently puts forward (cachet or election winner), with one-click delegation. This is the discovery path topic-scoped delegation was missing: members were told delegation is per-category, then handed a free-text field.
- Groups can run **optional internal lanes**: a per-group discussion lane and proposals lane, both off by default, with `members`/`public` read visibility. Lanes reuse the site's own `/discussion` and `/petitions` surfaces through a `?group=` scope rather than duplicating them, so pagination, evidence, comments, stances, quorum, votes and delegated ballots all work inside a group unchanged. Group-scoped entries are excluded from the Circle feed — that subtraction is what makes a lane internal.
- A group discussion or proposal can be **promoted to the upper level**: to the parent group, or to the whole Circle when the group is top level. It is a move, not a copy, so the item keeps its id and its comments, signatures and votes travel with it; the trail is stamped on the item and shown as a pill. Group admins and Circle moderators may promote, and promotion into a parent whose matching lane is closed is refused rather than dropping the item somewhere unreachable.

- Proposals now take the member's category. The petition routes discarded a submitted topic and classified from body text, and with no gardener or classifying extension installed the classifier only ever returns the first anchor — so on a default deployment **every** proposal landed on `general`, collapsing topic-scoped delegation, category filters and breadcrumbs into one bucket and leaving the whole category hierarchy nothing to match. Compose and draft-edit now carry a Category field (with the shared topic datalist); a member's pick is authoritative, an edit that omits it keeps the existing category, and the classifier remains the fallback for when nobody chose. The end-to-end payoff is verified: a delegation on the parent category `Energy` now reaches a proposal filed under `Energy / Solar` and resolves to a named delegate with a live deadline — three things that were each independently broken before this work.
- Groups gained a **lane-moderator** role between member and admin. It can act on what the lanes carry (promote an item, decide a promotion request) but cannot change policy, categories, delegates or roles — the things that define what the group *is*. Roles are visible to members and assignable by admins only, and a group can never be left without an admin.
- **Promotion requests** give an ordinary member a move. Promotion is an admin/lane-moderator action, which left a member who thought a branch discussion belonged at the parent level with no path at all. A request is visible to the group, auditable, decidable only by someone who could promote (never by the asker), declinable with a reason that reaches the asker, and cannot stack. An approval blocked by a closed parent lane leaves the request open rather than silently consuming it.
- **Branch election roll-up** is opt-in, parent-side (`adoptBranchElections`). A group that asks for it also considers its branches' closed elections for a category it has not voted on itself, resolved at read time so it stays correct when the branch re-elects, and labelled with the branch it came from. A group's own election always wins where it has one, and roll-up never reaches sideways into an unrelated group — a parent silently adopting a branch's vote would make that branch bind people who never joined it.
- The demo face is political and English. The README walkthrough is Scenario A only — *Rete Civica Nazionale* taking real Italian policy questions from a message to a decision — with English copy over an Italian legal world, 23 asserted captures from `scripts/party-journeys.js`, refreshed by `npm run screenshots:readme` against an isolated strict-Circle store. The run now also covers the forum's free-mandate argument, a rebuttal placed under the node it answers, a revision that answers its own deliberation, delegate public bios, the party's constitution defaults, and a member-proposed constitutional change decided in `/admin`. The care-cooperative walkthrough and its images are retired; `user-journeys.js` remains as the organization-operations regression driver, and `seed-demo.js` now seeds a compact Scenario A slice. Scenario A topics are one English category tree (`Healthcare / Waiting lists`, `Labour / Minimum wage`, …), so parent-category delegation, the group directory and breadcrumbs resolve against the same paths.
- That pass fixed real defects the captures exposed. `CIRCLE_POLICY_ID` was silently ignored on every fresh store (a migration wrote a literal default into settings, which outrank the env); it and the new `CIRCLE_NAME` knob now seed the store. Forum replies and proposal discussions read newest-first, so an answer sat above its question — threads now run oldest-first, with the comment form after the notes. The ballot select reset a member who had voted "yes" back to "abstain", one click from silently changing the vote. Rebuttals printed a raw node id instead of the claim they answer; the category directory listed an election winner twice (cachet + elected); governance history showed event types (`proposal_approved`) and hid who proposed a change behind who decided it; revision bylines bypassed the shared `@handle` label.
- Theme-level verbosity controls are live: admin default + per-session overrides in `/profile`, plus a top‑bar toggle and per‑page presets via Composer.
- Composer mode now supports per-page layout ordering (including main/aside swaps), panel hiding, per-page verbosity presets, and persisted text/style + DOM order overrides for composer-keyed elements.
- On phones, the inactive Composer entry sits below the topbar in normal page flow so it leaves member forms reachable.
- Modern HSL semantic-token UI (dark-first) is live: a single `--primary-h` accent knob re-tints the whole system, with legacy hex vars aliased onto the tokens. Members get per-view "Appearance" (accent hue + theme + density) and per-page "Sections" show/hide controls persisted to `person.uiSettings` and honored server-side (`data-member-hidden`), distinct from the admin-only deployment-default Composer.
- Light and system themes are live alongside dark: `:root[data-theme="light"]` re-declares only the neutral/status/overlay tokens, so the accent engine and every accent preset work in both. `system` is resolved by a `prefers-color-scheme` media query rather than JavaScript, so it holds on the first paint and with JS disabled. The pass tokenized the ~150 theme-blind `rgba()` literals component CSS still carried (hairlines, recessed wells, the mint marker) into HSL channel triplets — verified lossless in dark mode — and every member-facing route is now audited to WCAG AA in both themes, which also fixed three pre-existing dark-mode contrast failures (avatar discs, `stance--question`/`--neutral` chips, and a `stance--proposal` chip that ignored the member's accent).
- The member "Sections" control lists opted-in shell panels with a stable key and a friendly `data-section-label`. The admin Composer's index-derived `panel-N` keys shift with page shape and stay outside the member list. Both rules are test-enforced.
- The appearance vocabulary has a single source: the layout ships `data-ui-vocabulary` from `interfaceSettings.js`, so `app.js` no longer keeps a hand-maintained copy of the accent/density/theme key lists.
- The reference-modern structure now reaches `/discussion`, `/petitions` and `/organization` on top of the home/social/forum exemplar: content leads the main column and short controls sit in the right rail, so a compose form no longer sits above the feed it contributes to. `/organization`'s full-width marketing hero is demoted to a compact strip, putting the pressure inbox above the fold as the AGENTS contract requires.
- Two layout defects surfaced and were fixed while rolling it out. The aside rail is now a plain column: capping it with `overflow: auto` clipped an expanded compose form so its own submit button sat outside the rail, and making it sticky was worse, because a sticky element taller than the viewport pins and stops moving, leaving everything below the fold unreachable — either way the member could not submit. And `.page-grid` now collapses on its own container width instead of the viewport's, since a viewport-keyed breakpoint ignored the ~240px side-nav and left the main column at ~160px on a ~850px screen.
- The reference-modern structure now reaches **every** member-facing route. `/governance`, `/delegation`, `/delegates`, `/groups`, `/notifications` and `/profile` moved to the same grid shape, and `/admin` was decomposed from a single 742-line template into 7 grouped partials (closing the template-hygiene item) with all 20 of its panels section-tagged; it stays single-column on purpose, since the shared side-nav already is the reference "dashboard shell" and each panel is a jump target. The whole set is verified per UIReview: 13 routes × 2 themes, zero contrast failures, zero horizontal overflow, every panel labelled.
- The shared favicon is self-hosted. The Citizen OS rollout has delivered the shared desktop rail, narrow-screen disclosure, palette, panel and action styles, the Home and Discussion headers, and Forum browse and article views. Focused proposal workspaces and scoped proposal activity links are live. Group workspaces and destination-labelled promotion approvals are live. A member who requests a move still needs a separate decider if they later gain moderation rights. The remaining activity views follow. Composer work follows the shared components. [UI delivery and acceptance](UI_ROADMAP.md#8-delivery-order-and-acceptance)
- HTTP templates now live under `src/modules/<module>/templates/` with per-module controllers in `src/modules/<module>/http/` for clearer ownership (partials under `templates/partials/`).
- Persistence adapters (json/memory/sql/kv/mysql/mongodb), data modes, preview gating, gossip scheduler, and peer health/quarantine are in place.
- Structure manager UI for provider-local fields and attributes is available, with schema-staleness cues on profile edits; topic preferences + topic registry/breadcrumbs + gardener worker with scheduled refactors and admin review for rename/merge/split + anchor suggestions are wired.
- Peer health now records peer ledger hash snapshots with match/mismatch cues for audits; gossip summaries include run durations in `/admin` and `/health`.
- Peer capability snapshots (module toggles + data mode) are gossiped alongside ledgers, cached per peer, surfaced in `/admin`, and used to skip disabled endpoints.
- Peer capability hints now store stable fingerprints, and provider-blind announcements are cached by `updatedAt` to reduce repeated gossip normalization work.
- Gossip pull now runs peer fetches in parallel and caches optional endpoint skips (`/votes/ledger`, `/transactions/ledger`) after module-disabled/not-found responses, reducing repeated failed probes.
- `/admin` and `/health` now surface optional-endpoint skip cache summaries so operators can observe skip behavior and TTL impact.
- Gossip push now caches endpoint skips (`/circle/gossip`, `/votes/gossip`, `/transactions/gossip`) after module-disabled/gossip-disabled responses, reducing repeated failed retries on outbound sync runs.
- Ledger/vote/transaction exports gzip-compress when clients request `Accept-Encoding: gzip` and payloads are at least ~2KB.
- Provider-blind scaffolding is live: `/admin` policy fields (observe/strict), ring registry + audit committee metadata, canonical envelope helpers, ringSignature placeholders on vote/transaction envelopes, and gossip announcements for ring registry + audit keys.
- Optional Circle key generator ships with libp2p-backed ring identity output; `CIRCLE_RING_ID` pre-fills provider-blind ring IDs in `/admin`, which also surfaces signing key status and accepts PEM ring key blocks.
- `/admin` can generate signing keypairs and persist them into settings (env overrides on restart).
- Social puts the follow filter alongside results and the audience beside the send action. The composer opens through native HTML and scrolls with the page. An empty composer can still auto-collapse after the reader passes it, subject to the member's Interface preference. Direct replies and media use the source post's audience.
- Top-bar Interface settings now let users tune practical UX at runtime (large text, reduced motion, compact nav, composer auto-collapse preference, and partial-navigation mode), side-nav jump filtering with `Ctrl/Cmd+K` + `/` shortcuts improves day-to-day navigation, and users can save those toggles as session defaults inline without leaving the current page.
- Home route now behaves as an operational workspace for guests and signed-in members, surfacing access gates, recent conversation/proposal/audit activity, and operator cues instead of redirecting verified sessions straight to `/social/feed`.
- Home/discussion/social/petitions templates were cleaned to reduce demo-like filler text (`Next action`, generic onboarding headings) and now present concise operational copy focused on real workflows.
- Identity is now legible and discoverable (real-life-readiness pass): members set a validated, unique handle on `/profile`; a shared `resolveHandleForHash`/`renderActorLabel` helper renders `@handle` (with a short hash cue) across delegation, delegate profiles, petitions (including the discussion-feed widget, argument-map nodes, and updated/freeze meta), discussion, forum, social, and the home audit lane instead of raw pid hashes; a browsable People directory at `/delegates` (with search) plus handle pickers (datalists) on the delegation and follow forms replace free-text hash entry, and delegation resolves a typed handle/hash to a known verified person.
- Notification labels are humanized (`humanizeNotificationType`) so `/notifications` shows readable titles (e.g. "Proposal created", "You were mentioned") instead of raw event types like `petition_created`.
- Long lists paginate: shared `paginate`/`renderPager` helpers add SSR pagination (page size 20, query-preserving prev/next that respects topic/stage/follow-type filters and partial navigation) across all four high-traffic lists — discussion, petitions, forum threads, and the social feed.
- Provider-local extension lifecycle is live: `/admin` and `/extensions` discover catalog files, distinguish installed/enabled/active state, persist installed versions and timestamps, flag version drift for updates, and uninstall non-destructively while disabling active hooks.

## Near-term next steps (Phase 2 focus)
- People profiles, governance changes, and the organization case now use the record header, section, and context pattern. `/profile` has the same identity header with labelled settings sections and inline status/field errors, the wallet handoff and result are focused task pages with refresh and restart recovery, and the organization preview keeps its Preview label and live-queue link in a persistent header. `/admin` now has a heading, a grouped index of its 20 sections, and confirmations rendered in the section that was submitted. Form values are escaped in one pass, which closes an unescaped echo of member profile fields. People and Groups directories now search and paginate, and discussion and group notifications open their records through the same read gate as a direct visit. Social updates have a focused view with parent and replies under the source audience, and Social alerts link to it. Next: a focused governance change record once members ratify changes. [UI roadmap](UI_ROADMAP.md#settings-and-task-pages)
- Extend the organization case kernel to shared email intake, bounded outbound replies, and a tracked response time. The live discussion path uses attributed provider visibility and a review date.
- Protected voice: design the separate audited intake/relay and identity-reveal policy before claiming anonymity; keep raw relay mappings and mediation detail provider-local.
- Organization layer stores: add versioned commitments, hierarchy/flow edges, authority grants, funds/reconciliation, sector links, mediation, pressure observations, and impact reviews lazily behind their module toggles.
- Pressure analytics guardrails: start with human-readable aggregate volume/velocity/persistence/spread components and cohort suppression; defer prediction and automated relief until baselines, uncertainty, and accountable authorization are tested.
- Admin module lifecycle: provider-local catalog discovery, install/update/uninstall state, and version tracking are live; next hardening is signed remote catalog acquisition, compatibility constraints, and rollback bundles for externally downloaded extensions.
- Admin Composer: extend the layout builder with component palette + insert/delete/wrap operations and richer component-level property editing beyond panels + nav (multi-select, reusable blocks, richer property groups).
- Template hygiene: admin, discussion and petitions are split into `templates/partials/`; the remaining single-file templates (groups, delegation, notifications, profile, forum, governance) are each small enough to stay whole for now — split them when a panel grows or is reused.
- Deliberative workbench upgrades: structured proposal templates and argument-map linking landed in petitions; evidence/citation prompts now live on discussion notes, with richer pro/con trees and community fact-check workflows still pending.
- Governance module: constitution defaults plus community change proposals, admin decisions, and auditable history are live; deeper member-ratified constitution changes remain pending.
- Delegation trust UX: delegate profile views, transitive chain visualization, and an advisory deliberation score are live; reputation depth (topic-expertise weighting, cross-provider reputation) remains.
- Delegation safeguards: transitive delegation resolution (cycle/depth/banned guards), decay/renewal cycles (admin-configurable `delegationDecayDays`), delegated-ballot resolution with a configurable delegate vote window (`delegateVoteWindowDays`, default 5), hierarchical topic matching, and a "rising star" discovery cue are live; transitive power-weight computation ("explain my influence" weighting) remains.
- UI preferences: browser-local controls plus inline session-default saves are live, and light/dark/system theming ships with them; next step is optional provider-profile sync across sessions/devices.
- Harden federation: ActivityPub inbox/outbox processing, cross-provider petition/vote visibility, and scaffolding for Claim & Seize migrations.
- Module boundary hardening: keep `organization operations`, reusable `social/community`, and `civic governance` behind clear namespaces/contracts so a hospital, company, cooperative, association, or civic Circle can compose only what it needs.
- Evaluate libp2p gossipsub channels for social-lane transport while keeping civic vote/transactions envelopes on signed audit paths.
- Extend replication tests for hybrid/p2p modes (preview gating, policy mismatch quarantine, skipped optional endpoints).
- Provider-blind hardening: replace placeholder ringSignature with real ring signatures, add issuer escrow + audit reveal workflow, enforce ring registry validation against Circle key registry, and ship provider-blind gossip tests (observe vs strict).
- Next-next steps: expand multipart integration tests with malformed-boundary/fuzzed header cases to harden parser edge behavior.

### Phase 1 — Messaging Kernel & Circle Policy (Months 1-4)
- Deliver the general communication kernel and organization reference UI before persistent advanced workflow: shared inbox/thread intake, bounded reply, manual case promotion contract, and independent organization module toggles.
- Deliver the messaging layer (discussion/forum/notifications) with handles and roles; OIDC4VP marks a session as “person” to enforce the natural-person exclusion principle where required, while allowing messaging to run in a lighter user-only mode.
- Add the follow graph + micro-post lane: typed follows (circle/interest/info/alerts) drive `/social/feed` with short posts + replies/mentions/reshares plus optional provider-local media uploads (view requests notify authors); keep UX copy explicit that this lane is for small talk/info and gated by the same role/ban checks as discussions.
- Add core module toggles in `/admin` so petitions/votes/delegation/groups/federation/topic gardener/social can be disabled for messaging-only deployments; nav and endpoints respect disabled modules.
- Add ledger digests to gossip envelopes and reject mismatched ledgers; centralized mode disables gossip ingest to avoid unintended replication.
- Add scheduled gossip push/pull and admin controls for manual sync runs.
- Treat module-disabled/gossip-disabled peers as skipped (no peer-health penalty), and disable gossip controls in `/admin` when data mode is centralized.
- Add Puppeteer UI flows and ring gossip smoke tests to validate role gates, module toggles, and P2P consistency.
- Model and validate data exchanges: persisted discussions/petitions/votes tied to session hashes, with rate limits, quorum/ban checks, and audit-friendly logs (discussions/forum/social/group actions plus petition signatures/comments; petitions/votes can stay disabled in messaging-only deployments).
- Expose manual delegation preferences (per-topic overrides) alongside conflict resolution so recommendations remain non-binding.
- Add signed vote envelopes and gossip endpoints (`/votes/ledger`, `/votes/gossip`) so auto-delegated votes are verifiable across providers and resistant to injection/replay when the petitions/votes module is enabled.
- Add transactions summary gossip endpoints (`/transactions/ledger`, `/transactions/gossip`) to exchange signed audit digests for cross-provider reconciliation.
- Surface inbound transaction summaries in `/admin` so operators can verify gossip reconciliation at a glance.
- Gate gossip ingest on policy id/version mismatches and track peer health/quarantine scoring.
- Expose peer health summaries plus vote gossip updated counts in `/health` and reset actions in `/admin` for ops workflows.
- Identity-based rate limiting (per handle/session with IP fallback) configured in `/admin` to avoid CAPTCHA.
- Extract persistence behind an interface (JSON today, pluggable DB tomorrow) with migrations for ledger/sessions/discussions/petitions/votes to keep user data durable.
- Keep identity foundations minimal-but-real: OIDC4VP/OpenID hash validation, key management, and QR/deep-link UX; defer deeper protocol details until the user/data flows are reliable.
- Federation stays stubbed (ActivityPub actor/outbox + inbox ingestion preview plus ledger gossip placeholders) to avoid blocking local UX or messaging-only deployments; hardening is a later phase.

### Phase 2 — Deliberation & Structure (Months 5-7)
- **Organization pressure cases** have persistent discussion sources, evidence by reference, voice type, scope, acknowledgement, and a review date. Add finer visibility policies and additional source channels as their access and audit rules land.
- **Organization structure layers**: commitments/responsibilities, contextual hierarchy and observed-flow edges, explicit authority grants, financial context, sector relationships, protected mediation, explainable pressure components, and impact review remain separate module-owned records.
- **Petitions module**: collaborative drafting with signature thresholds; signatures tied to verified sessions.
- **Topics/Taxonomy**: nested topics with usage-based promotion/pruning; users (people when civic proof is on) select top categories while admins/policy voters can pin mandatory/legal/departmental anchors; identity-rate-limiting instead of CAPTCHA.
- **Personalizable structure manager**: admin schema/data-table editor for provider-local optional fields/tables while locking canonical account fields (handle + credential/wallet binding, role/banned flag, blinded hash). Optional contact data (email/notifications) remains local and fuels provider-owned delivery/consent flows; example: handle + password stays required even when email is optional.
- **Topic gardener helper**: implement the DynamicTopicCategorization flow (online ingestion + scheduled merge/split/rename) as a Python service in `src/infra/workers/`, exposed via a stable API to `src/modules/topics/classification.js` so multiple providers stay reconciled (no conflicting labels) and redundant processing is avoided. Use it to surface trends, aggregate dispersed discussions, and pull isolated clusters toward active threads.
- **Group delegation & elections**: groups manage internal delegate cachets and elections; recommendations remain advisory, users can always override. Conflict rules can require user choice instead of auto-selection, and vote-mode recommendations should prefer the latest closed election winner. Cachets and elections resolve narrowest-topic-first, so a subcategory cachet outranks the group's general one.
- **Subgroups and group-level structure**: shipped — branch groups with a depth cap, group-declared categories in the shared topic registry, the `/groups` category directory for delegate discovery, optional per-group discussion/proposal lanes with members-only or public read visibility, and promote-to-upper-level for both lanes. Election roll-up, lane-moderator roles and promotion requests all shipped alongside it. Remaining: cross-group category stewardship (a branch renaming a category its parent also uses), and group-scoped delegate reputation.
- **Privilege-free Circle bootstrap (optional)**: allow Circles to start without seeded roles beyond provider admins; group elections and member votes can grant roles and context-specific structures as they evolve.
- UX: guided flows for “draft → discuss”, inline status chips (petition stage, quorum), and topic breadcrumbs.
- **Deliberative workbench**: structured proposal templates and argument-map linking are shipped in petitions; next steps include deeper pro/con trees, evidence/citation prompts, and community fact-check workflows.
- **Governance module**: digital constitution for quorum/debate windows/voting-method defaults, with community proposals, audits, and admin emergency overrides.
- **Delegation trust UX**: delegate profiles (bio, vote history, delegation counts), chain visualization, and initial reputation metrics (deliberation score).
- **Topics/Taxonomy**: reinforce dynamic topics + anchors with clearer stewardship cues and topic history context across deliberation surfaces.
- UX: guided flows for “draft → discuss → freeze”, argument-map entry points, evidence badges, and topic breadcrumbs.

### Phase 3 — Decision Engine (Months 8-11)
- **Voting module**: multi-method ballots (Condorcet/STAR/approval), anonymized ballot storage, and E2E-verifiable receipts + bulletin board.
- **Ranked-choice ballots (person elections)**: group delegate elections already capture up to three preferences with multi-round transfers (Alaska-style); extend the same ranked-choice capture to the core voting module when it lands.
- **Delegation graph**: transitive delegation, decay/renewal rules, and a worker to compute power weights with “explain my influence” summaries.
- **Reputation system**: multi-dimensional trust metrics (deliberation score, vote history, topic expertise) to feed delegate discovery and anti-super-delegate safeguards.
- UX: ballot clarity (options, ranking helper), delegation previews, and trust cues.

### Phase 4 — Federation Hardening & Migration (Months 12-14)
- **Claim & Seize** protocol: signed migration requests to move history across providers when the same wallet re-verifies.
- **Circle health**: scheduled peer audits for policy compliance; automatic quarantine of toxic peers.
- **Cross-provider access**: view/vote on petitions across providers with signed envelopes and policy gating.
- **Provider-blind mode (optional)**: complete ring signatures + issuer escrow, finalize audit-reveal governance, and add mixnet/onion transport so provider attribution is hidden without losing accountability.
- UX: migration status banners and audit transparency dashboard.

### Phase 5 — Accountability & Launch (Months 15+)
- **Accountability dashboard**: ingest legislative vote data, compare with platform decisions, compute fidelity scores, and provide representative justification space with a public audit trail.
- **Ethical pact + representative role**: candidate pledge capture, divergence explanations, and reputation linkages for re-selection flows.
- **Phygital inclusion + digital literacy**: offline agenda exports, kiosk/QR check-ins, SMS/print briefs, and training content hooks.
- **Information integrity**: disinformation reporting workflows, evidence citation requirements, and optional third-party fact-check integrations.
- **Cross-language access**: integrated machine translation for deliberation surfaces in multi-lingual Circles.
- **Launch polish**: SEO metadata for petitions/proposals (schema.org), eIDAS 2.0/ARF compliance audit, and mobile-first verification refinements.

# General roadmap

This version keeps the **"Party Circle"** and **European Digital Identity (EUDI)** integration as a first-class capability while keeping the day-one footprint messaging-first. Verification enforcement is policy-driven per Circle: enable it to mark users as people (natural-person guarantee) or run in lighter user-only mode. The first milestone is an operative messaging network with handles, role-aware privileges, and end-to-end validated data flows; protocol depth and federation details harden afterward.

### **Technical Philosophy & Stack Overview**

  * **Backend:** **NodeJS**. Built as a modular monolith where the "Identity Verifier" is a distinct, swappable micro-service.
  * **Frontend:** **Hybrid SSR + Vanilla JS**.
      * **SEO:** Server-Side Rendering (SSR) for distinct URLs and indexing.
      * **Performance:** Vanilla JS "Router Interceptor" for an app-like feel (fetching partial HTML/JSON) without heavy framework bloat.
  * **Protocol:** **Federated (ActivityPub) + OIDC4VP**.
      * **Identity:** Decoupled. The server knows *that* you are a unique user; when civic proof is enabled it marks you as a person (natural-person guarantee) without learning *who* you are.
      * **Federation:** "Party Circle" servers share a "Allow List" of trusted providers and sync user uniqueness hashes to prevent double-voting across the network.

-----

### **The "Party Circle" Module: The Constitution of Trust**

This is the civic trust layer when a deployment joins or forms a Party/Social Circle. Messaging can run without it, but enabling it binds providers into a trusted Circle.

#### **1. The "Verifier" Role (OIDC4VP & EUDI)**

Instead of a traditional login (email/password), the framework acts as a **Verifier** using the **OpenID for Verifiable Presentations (OIDC4VP)** standard.

  * **The Flow:**
    1.  User clicks "Login with EU Wallet."
    2.  The server generates a QR Code / Deep Link requesting a **Unique Pseudonymous ID** (PID) from the user's EUDI Wallet.
    3.  **Privacy Logic:** The request explicitly asks *only* for a unique hash (e.g., `hash(NationalID + Salt)`), **not** the user's name or address.
    4.  **Zero-Knowledge Proof:** The wallet proves the user is a valid person of a specific region without revealing their identity to the server.
  * **Non-EU Regions:** The module is abstract. A "Circle" in the US could swap the EUDI OIDC4VP driver for a different OIDC provider (e.g., a state ID system), provided it guarantees uniqueness.

#### **2. The "Uniqueness Ledger" (Anti-Sock Puppet)**

To ensure **One Person = One Vote** across the entire federation (not just one server), the Circle maintains a shared ledger of anonymized user hashes.

  * **Mechanism:** When a user registers on *Provider A*, their anonymized PID hash is broadcast to *Provider B* and *C*.
  * **Check:** If *Provider B* sees a new registration attempt with the same PID hash, it blocks it. This prevents a user from creating multiple accounts across the federation to rig votes.

#### **3. Frictionless Migration (The "Escape Hatch")**

  * **Policy:** Users own their identity, not the provider.
  * **Migration:** Because the identity is based on the external EUDI wallet, a user can leave a "toxic" provider and log in to a new one. The new provider verifies the same EUDI wallet, recognizes the unique hash, and (via the ActivityPub federation) can "seize" the user's history from the old provider, cryptographically signing the transfer.

-----

### **Module Compartmentalization**

| Module Name | Role & Policy |
| :--- | :--- |
| **1. Party Circle (Civic kernel, optional)** | **Governance:** Manages OIDC4VP strategy, the "Uniqueness Ledger," and the list of federated peers when Circle mode is enabled. <br> **Policy:** Enforces the "One person/person, One Voice" rule, applies the natural-person exclusion principle, and handles "Toxic Provider" exclusion lists. |
| **2. Discussion (Agorà)** | **Debate:** Standard threads with "Pro/Con" structure. <br> **Policy:** linked to the verified handle (user-by-default, person badge when civic proof is on) so participants are accountable to their unique hash. |
| **2. Deliberative Workbench (Agorà)** | **Debate:** Structured deliberation with argument mapping, evidence prompts, and collaborative drafting. <br> **Policy:** linked to the verified handle (user-by-default, person badge when civic proof is on) so participants are accountable to their unique hash. |
| **3. Dynamic Topics (Ext.)** | **Organization:** Users create nested category trees (tags). <br> **Policy:** Topics evolve organically based on usage metrics. |
| **4. Petitions (Ext.)** | **Initiative:** Collaborative drafting of laws/proposals. <br> **Policy:** Git-like version control for text. Requires a signature threshold (Quorum) to move to Discussion. |
| **5. The Connector** | **Workflow:** Logic engine (Petition $\rightarrow$ Discussion $\rightarrow$ Vote). |
| **5. Governance (Digital Constitution)** | **Rules:** Community-managed parameters (quorum, debate windows, default voting methods) with an auditable change history. |
| **6. Voting** | **Decision:** Secure ballot box with multi-method tallies and E2E verifiability. <br> **Policy:** Ballots are anonymized from the voter identity. |
| **7. Delegation & Trust (Liquid Ext.)** | **Representation:** Extension for Voting. <br> **Policy:** Manages the graph of trust with transitive delegation, decay/renewal, and reputation signals. |
| **8. Accountability Dashboard** | **Accountability:** Compares platform decisions with representative votes, exposes fidelity scores, and hosts public justifications. |
| **9. The Connector** | **Workflow:** Logic engine (Petition $\rightarrow$ Discussion $\rightarrow$ Freeze $\rightarrow$ Vote). |

-----

### **Implementation Roadmap**

#### **Phase 1: Messaging Kernel & Civic Hooks (Months 1-4)**

*Goal: Build the messaging kernel with optional OIDC4VP/ActivityPub civic Circle hooks.*

1.  **NodeJS & OIDC4VP Setup:**
      * Initialize the server (Fastify/Express).
      * Implement the **OIDC4VP Verifier**: Use libraries like `@sphereon/oid4vc-common` or `@credo-ts/openid4vc` to handle the handshake with EUDI Wallets.
      * **The "Blind" Token:** Create the logic to receive the Verifiable Presentation, validate the government signature, and hash the Subject ID for storage.
1.  **OIDC4VP & Session Scaffolds:**
      * **Complete:** OIDC4VP verifier scaffold with blinded PID hashing, session roles, and policy toggles for person enforcement.
      * Keep verifier enforcement behind a policy toggle so messaging-only deployments can run without civic proof while still supporting the exclusion principle when enabled.
2.  **Federated Identity Registry:**
      * Build the `UserHash` table.
      * Implement the **ActivityPub Actor**: Every user is an Actor (`@hash@server.party`) with outbox stubs plus preview-gated inbox ingestion.
      * **Uniqueness Sync:** Create a "Gossip Protocol" where servers exchange hashes of new users (with ledger digests) to enforce uniqueness constraints when Circle mode is enabled.
3.  **Frontend Framework (SSR + Vanilla):**
      * Set up the template engine (EJS/Pug).
      * Build the "Deep Link" handler: A generic JS module that detects `openid-credential-offer://` links and triggers the user's installed EUDI Wallet app (or displays a QR code on desktop).
      * **Complete:** ActivityPub actor/outbox plus preview-gated inbox ingestion.
      * **Complete:** Uniqueness sync gossip with ledger digests to enforce cross-provider uniqueness when Circle mode is enabled.
3.  **SSR Shell + Wallet Handoff:**
      * **Complete:** SSR templates with partial HTML navigation.
      * **Complete:** Deep-link + QR wallet handoff handling.
4.  **Messaging baseline:**
      * Ship SSR discussion/forum surfaces and the notification registry as the default value even without petitions/votes enabled.
      * Keep handles/roles visible so policy can later enforce the person-only exclusion principle without reworking the UX.
      * **Complete:** discussion/forum/notifications + social feed as the default value even without petitions/votes enabled.
      * **Complete:** handles/roles visible so policy can enforce the person-only exclusion principle without reworking the UX.

#### **Phase 2: Deliberation & Structure (Months 5-7)**

*Goal: Give users/people deliberation tools when the organization opts in.*

1.  **Petitions Module:**
      * Build the collaborative editor.
      * **Signature Logic:** When a user "Signs" a petition, use their Verified Session to cryptographically sign the support. This prevents bot signatures.
2.  **Dynamic Topics:**
      * Implement a recursive SQL/Graph structure for topic trees.
      * Add logic to "prune" unused branches and "promote" active ones automatically.
3.  **Discussion Module:**
      * Link threads to Petitions.
      * Implement **Accountability**: Since users are unique, implement "Rate Limiting by Identity" (not IP) to effectively stop spam without captchas.
1.  **Deliberative Workbench:**
      * Structured proposal templates with evidence fields.
      * Collaborative drafting with revision history plus argument mapping (pro/con) UI.
      * Evidence/citation prompts with community fact-check flags.
2.  **Governance Module:**
      * Digital constitution for quorum, debate windows, and voting-method defaults.
      * Community proposal/change workflow with auditable history.
3.  **Delegation & Trust UX:**
      * Delegate profiles (bio, vote history, delegation counts) and delegation chain visualization.
      * Delegation decay/renewal controls and reputation scaffolds (deliberation score, topic expertise).
4.  **Privilege-free Circle bootstrap (optional):**
      * Allow Circles to start without seeded roles beyond provider admins.
      * Enable groups + member votes to grant roles and evolve contextual structures over time.

#### **Phase 3: The Decision Engine (Months 8-11)**

*Goal: Provide Liquid Democracy and Voting where the Circle enables it.*

1.  **Voting Module:**
      * Implement the **Schulze Method** for ranking options.
      * **Anonymity Layer:** Ensure that while *access* to the ballot box requires the OIDC4VP token, the *ballot itself* is stored in a separate table with no link back to the user hash.
      * Multi-method ballots (Condorcet/STAR/approval) with anonymized ballot storage.
      * E2E-verifiable receipts and a public bulletin board for tally verification.
2.  **Delegates Manager:**
      * Transitive delegation engine with decay/renewal and power-weight computation.
      * Reputation signals feed delegate discovery and “explain my influence” views.
3.  **The Connector:**
      * Automate the pipeline: *Quorum Reached $\rightarrow$ Open Discussion $\rightarrow$ Freeze Text $\rightarrow$ Vote* with review prompts.

#### **Phase 4: Federation Hardening & Migration (Months 12-14)**

*Goal: When Circle mode is enabled, ensure the federation is robust against bad actors.*

1.  **Provider Migration Protocol:**
      * Implement the **"Claim & Seize"** API. If a user logs into *Server B* with the same EUDI Wallet used on *Server A*, *Server B* sends a signed request to *Server A* to transfer the user's post history and delegation settings.
2.  **Circle Health Checks:**
      * **Policy Verification:** Servers periodically audit each other (e.g., checking if they are correctly enforcing OIDC4VP checks). If a server fails, it is automatically removed from the "Trusted Circle," isolating the toxic provider.
3.  **Cross-Provider Access:**
      * Allow a user on *Server A* to view and vote on a Petition hosted on *Server B* seamlessly, using the ActivityPub federation to transport the vote authentication.
4.  **Provider-blind mode (optional):**
      * Complete ring signatures + issuer escrow, finalize audit-reveal governance, and add mixnet/onion routing so provider attribution is hidden without losing accountability.

#### **Phase 5: Accountability & Launch (Months 15+)**

1.  **SEO & Indexing:** Ensure every Petition and Proposal has valid Schema.org metadata generated server-side.
2.  **EUDI Compliance Audit:** Verify the implementation against the final **eIDAS 2.0 / ARF** technical specifications to ensure the wallet integration is legally compliant for EU regions.
3.  **Mobile Optimization:** Refine the Vanilla JS interactions to ensure the OIDC4VP app-switching flow works smoothly on iOS and Android devices.
1.  **Accountability Dashboard + Ethical Pact:** ingest legislative votes, compare with platform decisions, compute fidelity scores, and capture representative justifications.
2.  **Phygital Inclusion + Digital Literacy:** offline agenda exports, kiosk/QR check-ins, SMS/print briefs, and training content hooks.
3.  **Information Integrity + Security:** disinformation reporting workflows, optional fact-check integrations, and third-party security audits/bug bounty posture.
4.  **Internationalization + Launch Polish:** integrated machine translation for deliberation, SEO/schema.org, eIDAS 2.0/ARF compliance audit, and mobile verification refinements.
