# AI Agent Reference

This is the fast-access handbook for agents working on the **Web Organization Framework**. Read it before changing code. Keep it synchronized with [README.md](README.md) and [ROADMAP.md](ROADMAP.md) whenever behavior, architecture, commands, or priorities change.

The product is a general-purpose, communication-first organization framework. **Party Circle is an optional civic policy bundle, not the product identity.**

## Read This First

Use these sources in this order:

1. This file defines day-to-day implementation rules, invariants, ownership, and where code lives.
2. [README.md](README.md) defines the public product description, operator workflow, configuration, and current capabilities.
3. [ROADMAP.md](ROADMAP.md) distinguishes shipped behavior from planned work and sets implementation priorities.
4. [UI_ROADMAP.md](UI_ROADMAP.md) defines the target shell, collections, focused workspaces, semantic HTML, visual system, and acceptance criteria using the pinned Citizen OS frontend as the design reference. Read it before touching presentation and update it in the same task. Initialize the optional reference checkout with `git submodule update --init -- thirds/citizenos-fe`.
5. [OPTIMIZATIONS.md](OPTIMIZATIONS.md) records performance, redundancy, UX-consistency, observability, security, and storage/IO work.
6. The linked principle documents below define the product philosophy and domain constraints. Do not silently reinterpret them in code.

When documents disagree with running code, verify the behavior with tests, then update the stale document as part of the same task. Never describe a scaffold, template preview, or protocol placeholder as production-complete.

## Collaboration Rules

- Preserve unrelated work in a dirty tree. Make focused, incremental changes and add regression coverage for behavior changes.
- Keep [README.md](README.md), [ROADMAP.md](ROADMAP.md), and this file aligned with real commands, routes, modules, data boundaries, and status.
- Add every newly identified optimization to [OPTIMIZATIONS.md](OPTIMIZATIONS.md), even when it is not implemented in the current task. This includes performance, redundant computation, UX consistency, observability, security, and storage/IO opportunities.
- Use the two canonical deployments in [principle-docs/SimulationScenarios.md](principle-docs/SimulationScenarios.md) for seeds, fixtures, screenshots, and journeys. Scenario A is the fictional Italian civic party; Scenario B is the fictional ASL organization-pressure deployment. Keep them in separate stores and preserve each action's `[drive]`, `[fixture]`, or `[design]` status.
- When you touch presentation (templates, [`app.css`](src/public/app.css), or view helpers), run the standing UI review in [principle-docs/UIReview.md](principle-docs/UIReview.md): drive Scenario A, walk the member-facing feed surfaces, and hold them to the "real forum/social product, not a demo" bar before committing. Scenario A is the default screenshot and UX lens; Scenario B is only for `/organization`. Also update [UI_ROADMAP.md](UI_ROADMAP.md) (per-surface status, section inventory, style/functionality checklists) in the same task.
- The README, screenshots, and demo seeds present the **representative-party mode** (Scenario A) in **English**: every string a member reads is English, while names, handles, institutions, and legal citations stay Italian. Do not reintroduce Italian UI copy or a non-political walkthrough as the product's demo face.
- Do not invent empty or generic demo content where a reference scenario applies. Empty deployments hide identity, pressure, workflow, and module-boundary defects.
- Prefer small, env-driven, documented modules that a human team can operate without AI assistance.
- Evaluate libp2p where it materially helps P2P transport, ring identity, or resilience. Keep civic votes and audit transactions on signed, validation-aware paths.
- Run the narrowest relevant tests while iterating and the appropriate full suite before handing off risky or cross-cutting changes.

## Essential Product Principles

### 1. Communication before structure

- The framework must be useful as messaging, threaded discussion/forum, and notifications alone.
- A message remains the canonical source. Promote it to an organization case only when acknowledgement, ownership, protection, authority, resources, mediation, pressure analysis, or impact learning adds value.
- Petitions, votes, delegation, topic gardening, social networking, organization layers, and federation are independently adoptable modules. An existing organization must not be forced to adopt the framework's entire operating model.
- Keep module families visibly separate: **Organization operations**, **P2P social/community**, **Civic governance**, and **Federation/resilience**. Social popularity or follows never imply governance authority.

The normative organization model is [principle-docs/OrganizationPressureManagement.md](principle-docs/OrganizationPressureManagement.md).

### 2. Pressure describes systems, never personal worth

- Model fundamental needs, constructive concerns, advice/innovation, resource consultation, and disputes.
- Explain aggregate pressure through volume, velocity, persistence, spread, consequence, and organizational capacity. Do not create opaque staff scores, personal pressure leaderboards, or automatic sanctions.
- Preserve expertise, accountable leadership, and emergency speed while making formal and actual working flows inspectable and feedback paths permeable.
- Never infer authority from a title. Model propose, validate, decide, veto, execute, observe, protect, and escalate rights with source, scope, conditions, and expiry.
- Keep responsibility, commitment, consultation, information, approval, execution, and financial reconciliation distinct.

### 3. Protection must be honest

- Ordinary email and discussion are attributed.
- Protected or anonymous intake requires a separate audited path, minimized metadata, an explicit reveal policy, retention/access controls, and human moderation.
- Never promise anonymous email. Never gossip protected identity mappings, contact metadata, mediation evidence, or reveal mappings.
- Disabled organization layers may show clearly labeled templates, but must not imply that they persist or execute workflows.

### 4. User by default; person only with a natural-person guarantee

- **user** is the default actor in general deployments.
- **person** is a civic/party Circle label meaning a verified natural person. Under strict Circle enforcement, the exclusion principle blocks organization, bot, and service accounts from holding handles or acting in flows.
- Store only blinded hashes from EUDI/OIDC4VP verification. Never retain raw PID or identity documents.
- A Circle may begin without special roles beyond provider administrators; groups, member votes, and contextual structures may evolve later.
- Render `@handle` plus a short hash cue through shared helpers. Never expose a raw PID hash as a person's primary identity.

The civic philosophy—One Person = One Voice, soft-power accountability, liquid delegation, and phygital inclusion—is defined in [principle-docs/RepresentativeParties.md](principle-docs/RepresentativeParties.md).

### 5. Recommendations and delegation stay non-binding

- Delegation is topic-scoped, revocable, visible, decay-aware, and always overridable by the user/person.
- Group cachets, election winners, extension suggestions, reputation cues, and deliberation scores are advisory. They must explain why a recommendation exists without silently exercising power.
- Transitive delegation must retain cycle detection, a depth cap, banned-delegate stops, and an understandable “explain my influence” chain.
- Accountability is soft power: auditable decisions and divergence explanations, not hard imperative mandates.

### 6. Centralized and P2P deployments share one domain model

- Centralized, hybrid, and P2P are data profiles, not code forks. Domain modules use the persistence abstraction and validation helpers.
- Settings select combinations: `DATA_MODE`, `DATA_ADAPTER`, `DATA_VALIDATION_LEVEL`, and `DATA_PREVIEW` determine storage, replication, and visibility.
- `centralized` disables gossip ingest; `hybrid` keeps a central canonical store with replicas/audits; `p2p` treats gossip ledgers as primary with an optional local cache.
- Preview and validated states remain explicit. `DATA_PREVIEW=false` blocks preview ingestion even when validation is `observe` or `off`.
- Provider-local profile/contact fields, protected mappings, media binaries, and mediation details never gossip.
- Providers in one social/party ring should prefer a shared or compatible client so UX, validation, and enforcement semantics remain aligned.

The provider-obscuring threat model and incomplete protocol design live in [principle-docs/Provider-Blind-Mode.md](principle-docs/Provider-Blind-Mode.md). Current `ringSignature` fields are placeholders; issuer escrow and mixnet transport remain future work. The scaffold does not provide finished anonymity.

## Critical Implementation Contracts

These rules protect behavior that is easy to break while working in adjacent code.

- **Provider administration:** `/admin`, `/admin/audit`, and `/extensions` use [`canAdministerProvider`](src/modules/identity/privileges.js). Moderators do not administer provider policy. The first-run exception is open only while no non-banned admin session exists; it keys off “an admin exists,” never `settings.initialized`. Every admin link must use the same gate so the UI does not advertise a route that returns 403.
- **Signing keys:** `CIRCLE_PRIVATE_KEY` and `CIRCLE_PUBLIC_KEY` contain PEM text, never filesystem paths. Read them through [`getSigningPrivateKey()` and `getSigningPublicKey()`](src/modules/circle/signingKeys.js), so malformed values degrade to unsigned envelopes instead of becoming OpenSSL 500 errors; `/admin` must report malformed keys as ignored rather than loaded.
- **Module gates:** definitions, families, dependencies, defaults, and admin links live in [`src/modules/circle/modules.js`](src/modules/circle/modules.js). Navigation and endpoints must honor disabled modules. HTML routes render the shared disabled page; JSON routes return a structured 403 through [`moduleGate.js`](src/interfaces/http/views/moduleGate.js).
- **Circle provenance:** verification is required by default but Circle enforcement is configurable and must remain visible. Set a stable public issuer with `CIRCLE_ISSUER` or `/admin` so gossip envelopes carry an auditable peer hint. `CIRCLE_RING_ID` only pre-fills provider-blind ring identity; it is not itself an anonymity or trust guarantee. Stored settings outrank the environment in `policy.js`, so any migration that first writes a setting must seed it from config (`POLICIES.id` ← `CIRCLE_POLICY_ID`, `POLICIES.name` ← `CIRCLE_NAME`), never a literal — a hardcoded default silently disabled `CIRCLE_POLICY_ID` on every fresh store.
- **Organization-layer independence:** `coordination` works alone. `protectedVoice`, `responsibilities`, `hierarchies`, `authority`, `funds`, `sectors`, `mediation`, `pressureAnalytics`, and `impactTracking` require only coordination and otherwise remain independently toggleable.
- **Delegated ballots:** a delegated vote is **not a choice**. It is stored as `choice: 'delegate'` plus a `delegate` binding (`hash`, `via`, `topic`, `at`, `deadline`) and resolved at read time by [`delegatedBallots.js`](src/modules/delegation/delegatedBallots.js) through the delegate's own vote, transitively, under the same cycle/depth guards as `resolveDelegation`. Never re-introduce the legacy `delegate:<hash>` choice string — no tally understood it, so every delegated ballot silently counted as an abstention; `readDelegatedBallot` still parses it only so pre-migration ledgers resolve. Count through `tallyVotes`, never by inspecting `vote.choice` directly. A ballot still inside its window is **pending** and must stay out of the yes/no/abstain buckets: folding it into the abstentions misreports the outcome while the delegate can still act. Only a lapsed or unresolvable ballot becomes an abstention. The delegate binding is part of the signed vote envelope, so changing its shape changes what peers verify.
- **Delegate vote window:** `delegateVoteWindowDays` (governance, default 5, 0 = no deadline) is the time a delegate has to cast a ballot handed to them. The member overrides at any time by voting themselves, which replaces the delegated ballot outright. A window is never applied retroactively to ballots cast before one existed.
- **Topic-scoped matching:** delegations, group cachets, and group elections are matched with [`buildTopicMatchKeys`](src/modules/topics/topicMatch.js), narrowest first (`environment/energy` → `energy` → `environment` → `general`), never by exact string — proposals are classified into nested paths, so exact matching means a parent-category delegation covers nothing. Pass the item's `topicPath` into `resolveDelegation` wherever it is known. Compare through `topicMatchRank`, which runs both sides through `canonicalizeTopicKey`: a preference is stored as the member typed it (`Energy / Solar` → `energy / solar`, spaces kept) while match keys join as `energy/solar`, so a raw string compare misses every path written the natural way. Keys are trim+lowercase, not slugified — slugifying would stop matching the stored values.
- **Group structure:** groups nest through `parentId` ([`groupTree.js`](src/modules/groups/groupTree.js)) with a depth cap, self-reference and cycle guards — validate with `validateParent` before writing one. Nesting is **structural, not authority**: a branch does not inherit its parent's membership, is not governed by it, and its cachets are its own. Branch depth is only a tiebreaker in `recommendDelegationForPerson`, applied after explicit priority, and it never silences a genuine disagreement between two branches at the same depth.
- **Group lanes:** a group's internal discussion/proposal lanes are **off by default** and live in group policy (`lanes`, `lanesVisibility`). They reuse `/discussion` and `/petitions` through a `?group=` scope — do not fork those surfaces. An entry carries `groupId`; `matchesGroupScope` excludes group-scoped entries from the Circle feed, and that subtraction is the whole of what makes a lane internal, so never widen a site-level query to include them. Read/post gates live in [`groupScope.js`](src/modules/groups/groupScope.js) and must be re-checked in the POST handler, not just used to hide the control.
- Build **Discussion contribution links** for the collection and `?post=<id>` through [`discussionLinks.js`](src/modules/discussion/discussionLinks.js). Resolve a post's stored lane and preview visibility for focused reads and promotion writes. Search only entries visible in the selected lane. Preserve the `discussion` page key and the browse filters and page on the return link.
- **Proposal workspaces and actions:** resolve access from the proposal's stored `groupId` for every item-id read and write. Use [`proposalLinks.js`](src/modules/petitions/proposalLinks.js) for scope-aware URLs and check `canReadProposal` before displaying proposal details in alerts and delegate queues. Editing, signing, commenting, and voting in a group lane require membership alongside the existing Circle action gate. A delegated ballot requires a holder eligible for the lane. Stage changes and promotions retain their own moderation checks and require access to the enabled source lane. Successful writes redirect to the relevant proposal view in its resulting lane. Ballot renders the exact frozen snapshot and links to its revision when available. Both moderation and quorum-driven voting use the shared freeze builder.
- **Petition topics:** the petition routes take `body.topic` as authoritative and fall back to `classifyTopic` only when the member did not choose (`resolvePetitionTopic`). Never go back to classifying unconditionally: with no gardener or classifying extension the classifier returns the first anchor for everything, which puts every proposal on `general` and silently disables topic-scoped delegation, filters and breadcrumbs. An edit that omits the field keeps the stored topic rather than reclassifying.
- **People records:** `/delegates/<hash>` sections are GET views (`?view=overview|delegations|votes|activity|endorsements`) built through `delegateProfileHref`. Pass the viewer's `canReadProposal` into `buildDelegateProfile` (`canReadPetition`) so a members-only lane proposal never reaches an outsider's profile counts or Activity. The Delegate action only pre-fills `/delegation?delegate=<handle>#delegation-set`; the POST still resolves and gates the target.
- **Group workspaces:** `/groups` browses the branch tree and category directory. `/groups?group=<id>` opens the record with Overview, Members, Decisions, and gated Settings. Readable lane links use the shared lane gate. Preserve the `groups` Interface page key and existing browse panel keys. Group writes redirect to their related section for ordinary and enhanced forms.
- **Group roles:** `member` < `laneModerator` < `admin` ([`groups.js`](src/modules/groups/groups.js)). `canModerateGroupLane` gates lane actions; `isGroupAdmin` gates everything that defines the group (policy, categories, delegates, roles). Do not widen `laneModerator` into those — a moderation role that can appoint moderators is an admin. `setGroupMemberRole` refuses to remove a group's last admin.
- **Promotion requests:** a member who cannot promote may ask (`applyPromotionRequest`); only someone who *could* promote may decide (`applyPromotionDecision`), never the asker. One open request at a time. An approval that fails its own preconditions must leave the request open — marking it approved would lose the ask while the item stayed put.
- **Election roll-up:** `adoptBranchElections` is opt-in and parent-side. A parent may adopt a *descendant's* closed election only, never a sibling's or an unrelated group's, and its own election always wins at the same topic. Adopted results carry `adoptedFromGroupName` and must stay labelled — a branch's vote presented as the parent's own would bind members who never joined the branch.
- **Promotion:** `/discussion` (`intent=promote`) and `/petitions/promote` move an item one level up — to the parent group, or to the Circle when top level — via [`promotion.js`](src/modules/groups/promotion.js). It is a **move, not a copy**: the item keeps its id so its comments, signatures and votes travel with it. Promotion only goes up. Refusals attach the resolved group for context, so build them with `refuse()` — spreading an `ok: true` context object over an `ok: false` verdict silently re-opens the gate, which is exactly how a non-member was briefly able to promote. Assert `ok` (not just `error`) when testing a refusal.
- **Policy gates:** posting, petition, vote, delegation, and moderation decisions go through [`src/modules/circle/policy.js`](src/modules/circle/policy.js) and [`src/modules/identity/privileges.js`](src/modules/identity/privileges.js). Do not duplicate role or ban logic in controllers.
- **Authentication UX:** the wallet flow must always expose QR and deep-link handoff, the hash-only privacy guarantee, and explicit session recovery/error states. Use identity-based rate limits with IP fallback to keep ordinary posting CAPTCHA-free.
- **Actor labels:** handle validation/indexing belongs in [`sessions.js`](src/modules/identity/sessions.js); UI labels belong in [`actorLabel.js`](src/interfaces/http/views/actorLabel.js). Use `resolveHandleForHash`/`renderActorLabel` anywhere an actor hash is shown. Handles allow letters, numbers, dashes, underscores, and dots, but never a leading/trailing or consecutive dot, so a civic Circle can use natural `@firstname.lastname` handles (`@giulia.ferrero`) without them becoming URL- or label-unsafe. Any control that takes a delegate/candidate/target must accept a `@handle` (or raw hash) and resolve it to the canonical blinded hash via the session index — never require the operator to paste a hash.
- **Partial navigation and enhanced forms:** `data-partial` links and enhanced forms may target only HTML routes. [`src/public/app.js`](src/public/app.js) checks content type and falls back to full navigation; never point a partial link at JSON/ledger exports. Enhanced form serialization must include `event.submitter` so named submit buttons keep their value (`approve` versus `decline`, for example); `new FormData(form)` alone silently drops that choice and can make the server execute its default branch instead of the action the member clicked. Preserve the ordinary no-JavaScript form semantics exactly.
- **Thread order:** lists of *threads* run newest-first; what is *inside* a thread (forum replies, proposal discussion notes, argument-map children) runs oldest-first, and the compose form follows the notes it adds to. A rebuttal names the claim it builds on (`describeArgumentParent`), never a raw node id; the stored `Argument note` placeholder is not a title. A member's ballot select starts on their current vote. `tests/deliberation-order.test.js` guards this.
- **Context panels:** render “what applies to me here” through [`renderContextPanel`](src/interfaces/http/views/contextPanel.js), keeping gates, facts, and guidance distinct. Do not recreate verbose label/value debug dumps with ad hoc callouts.
- **Member appearance and modularity:** the topbar Interface panel gives every member per-view controls — accent hue, theme, density, and a per-page "Sections" show/hide list — persisted to `person.uiSettings` (dynamic in `localStorage`, permanent via "Save as session defaults"), distinct from the admin-only Composer that sets deployment-wide defaults. Accent/density/theme render on the **`<html>`** element (`data-ui-accent`/`data-ui-density`/`data-theme`), never `<body>`: the token layer is declared on `:root` and resolves its nested `var(--primary-h)` there, so a `<body>`-level override does not reach it. A member hides a module by unchecking its panel; a panel opts in by carrying an explicit `data-composer-section` (and a friendly `data-section-label`) in its template. The key must be **stable and meaningful** — the Composer synthesizes index-derived `panel-N` keys for untagged panels and flags them `data-composer-synthetic`; the member Sections list excludes those, because such a key moves when the page changes shape and never reaches SSR. Server-side, `applyMemberHiddenSections` in [`templates.js`](src/interfaces/http/views/templates.js) stamps `data-member-hidden="true"` so the choice holds without JavaScript; `app.js` re-applies it live and must never fight the Composer while it is open.
- **Page layout:** member surfaces use `.page-grid` with content in `.page-main` and short controls in the `.page-aside` rail — content leads, so a compose form never sits above the feed it contributes to. The rail is a plain column on purpose: it must not be sticky, carry a `max-height`, or scroll internally. Both break once a panel outgrows the viewport — `overflow: auto` clips an expanded compose form so its submit button leaves the rail's visible box, and a sticky element taller than the viewport pins at `top` and stops moving, so nothing below the fold is reachable. Only a short, fixed-height panel may pin itself. The grid collapses through `@container shell-main (max-width: 700px)` (declared on `.shell main`), not a viewport media query, because the desktop rail takes 200 px plus its gutter. On narrower screens the same gated links are in the native Menu disclosure, outside the work grid. `tests/ui.test.js` → *compose forms stay reachable at a short viewport* guards this.
- Keep the **inactive admin Composer entry** in the document flow on phones so it leaves member controls reachable. The active tools use their movable overlay.
- **Theming:** `dark` (default), `light`, and `system` are the theme keys. Only the token block is theme-aware — component rules resolve through token names and must never carry a `:root[data-theme="…"]` override; retune the token instead. Do not add a raw `rgba()`/hex to a component: the hairline, inset, marker, status, overlay, and on-accent families all exist as HSL channel triplets (`hsl(var(--hairline-hsl) / 0.2)`) precisely so a rule can pick its own alpha without pinning a colour that cannot flip. `system` is resolved by a `prefers-color-scheme` media query, not JavaScript, so it survives the first paint and a JS-less client; that forces the light palette to be written twice, and `tests/interface-settings.test.js` asserts the two blocks stay identical. Text on an accent-tinted chip uses `--primary-ink`, not `--primary`.
- **Shell accountability:** retain visible Circle enforcement, validation/preview state, verified handle where present, ledger/actor/discussion counts, and gossip-ingest status in the shared shell/status surfaces.
- **SSR ownership:** route controllers live with their module under `src/modules/<module>/http/`; templates live under `src/modules/<module>/templates/`; reusable non-page controllers and view helpers live under `src/interfaces/http/`. Keep full and partial responses consistent.
- **Persistence:** mutate hydrated state through domain logic, then call the relevant function in [`storage.js`](src/infra/persistence/storage.js). Domain modules must not import a concrete JSON/SQL/KV/MySQL/MongoDB adapter.
- **Canonical organization cases:** `/organization` links one provider-local case to an attributed, validated, unscoped discussion post. Read the source and its evidence by id and recheck eligibility on reads and writes. Case access requires a signed-in session with posting permission. Acknowledging a case records receipt and a review date. Case records and their audit events stay provider-local. Richer records attach by case id in lazy, versioned, module-owned stores.
- **Audit coverage:** sensitive and user-visible actions should append through [`transactions/registry.js`](src/modules/transactions/registry.js). Discussion, forum, social, groups, petition lifecycle/signatures/comments, votes, delegation overrides, governance decisions, and outbound delivery should remain consistent with user-facing activity.
- **Topic stewardship:** discussions, forum threads, and petitions retain topic ids/paths so breadcrumbs and renames survive. Users/people select top categories; admins or policy voters may pin mandatory legal/departmental anchors. Gardener rename/merge/split and anchor promotion/archive suggestions remain reviewable, previewed, confirmed operations with history.
- Check **Social audience and media access** by id through [`canReadSocialPost`](src/modules/social/posts.js). A direct reply uses the original conversation's participants, and media view and report actions check the owning post. Uploaded binaries remain provider-local and locked by default. View requests notify authors, and reports or moderators may block viewing and resharing. Preserve streaming limits and temp-file cleanup in [`request.js`](src/shared/utils/request.js) and media policy in [`media.js`](src/modules/social/media.js).
- **Federation honesty:** module-disabled, gossip-disabled, and missing optional endpoints are skips, not peer-health failures. Policy/version/signature failures affect validation and quarantine. Centralized mode never ingests gossip.
- **Extensions:** [`registry.js`](src/modules/extensions/registry.js) separates discovered, installed, enabled, and active state. Uninstall is non-destructive and disables runtime hooks before deregistration. Do not add remote install paths without signatures/allowlists, compatibility constraints, and rollback design.

## Runtime and Data Flow

The main request path is:

`src/index.js` → `src/app/server.js` → `src/app/router.js` → module HTTP controller → domain module → `src/infra/persistence/storage.js` → selected adapter.

The main rendering path is:

module HTTP controller → shared view helpers → `src/interfaces/http/views/templates.js` → module template → core layout/partials → full or partial HTML.

The main federation path is:

Circle/vote/transaction controller → envelope verification and replication policy → ingest/gossip module → persistence + peer health/quarantine + ops metrics.

## Linked Source Tree

### Application entry and configuration

- [`src/index.js`](src/index.js) loads `.env` and starts the application.
- [`src/config.js`](src/config.js) owns environment parsing, data/media/request defaults, MIME types, and runtime paths. Add new operational knobs here and mirror them in [.env.example](.env.example) and [README.md](README.md).
- [`src/app/server.js`](src/app/server.js) initializes state, extensions, outbound transports, upload cleanup, gossip/topic schedulers, the HTTP server, and top-level request errors.
- [`src/app/router.js`](src/app/router.js) is the authoritative route table and method/path index. Add a route here only after choosing the owning module controller and its HTML/JSON gate behavior.

### HTTP interface layer

- [`src/interfaces/http/controllers/`](src/interfaces/http/controllers/) contains reusable non-page endpoints:
  - [`activitypub.js`](src/interfaces/http/controllers/activitypub.js): actor/object/outbox serving and preview-gated inbox ingestion.
  - [`circle.js`](src/interfaces/http/controllers/circle.js): ledger gossip, export, peer list, and peer registration.
  - [`extensions.js`](src/interfaces/http/controllers/extensions.js): admin-gated extension catalog and lifecycle actions.
  - [`health.js`](src/interfaces/http/controllers/health.js): health, policy, peer, gossip, upload, and ops metrics.
  - [`static.js`](src/interfaces/http/controllers/static.js): safe `/public/*` asset serving.
  - [`transactions.js`](src/interfaces/http/controllers/transactions.js): local audit list, signed export/ledger, and gossip ingest.
  - [`votes.js`](src/interfaces/http/controllers/votes.js): vote ledger export and signed-envelope gossip ingest.
- [`src/interfaces/http/views/`](src/interfaces/http/views/) contains shared SSR presentation logic:
  - [`templates.js`](src/interfaces/http/views/templates.js) loads module templates, partials, the shell, and verbosity modes.
  - [`navigation.js`](src/interfaces/http/views/navigation.js), [`status.js`](src/interfaces/http/views/status.js), [`adminGate.js`](src/interfaces/http/views/adminGate.js), and [`moduleGate.js`](src/interfaces/http/views/moduleGate.js) own global navigation/status and access-denied surfaces.
  - [`formFeedback.js`](src/interfaces/http/views/formFeedback.js) renders inline form confirmations (`role="status"`) and error summaries (`role="alert"` with an id that controls reference through `aria-describedby`).
  - [`actorLabel.js`](src/interfaces/http/views/actorLabel.js), [`contextPanel.js`](src/interfaces/http/views/contextPanel.js), [`shared.js`](src/interfaces/http/views/shared.js), [`topicHelpers.js`](src/interfaces/http/views/topicHelpers.js), and [`composerView.js`](src/interfaces/http/views/composerView.js) are the reusable identity, context, list, topic, and customization primitives.
  - [`homeView.js`](src/interfaces/http/views/homeView.js), [`discussionView.js`](src/interfaces/http/views/discussionView.js), [`forumView.js`](src/interfaces/http/views/forumView.js), [`petitionView.js`](src/interfaces/http/views/petitionView.js), [`profileView.js`](src/interfaces/http/views/profileView.js), and [`socialView.js`](src/interfaces/http/views/socialView.js) render module-specific fragments reused by controllers/templates.

### Identity, Circle policy, and provider control

- [`src/modules/identity/`](src/modules/identity/) owns authentication-derived identity and privileges:
  - [`auth.js`](src/modules/identity/auth.js) builds wallet offers, blinds PID values, and creates session cookies.
  - [`citizen.js`](src/modules/identity/citizen.js) resolves a verified request session into the contextual user/person; [`person.js`](src/modules/identity/person.js) is the compatibility export.
  - [`sessions.js`](src/modules/identity/sessions.js) indexes sessions and validates unique handles.
  - [`privileges.js`](src/modules/identity/privileges.js) centralizes role capabilities and provider-admin bootstrap rules.
  - [`rateLimit.js`](src/modules/identity/rateLimit.js) applies per-handle/session limits with IP fallback.
- [`src/modules/auth/http/auth.js`](src/modules/auth/http/auth.js) and [`src/modules/auth/templates/`](src/modules/auth/templates/) own the EUDI/OIDC4VP offer, QR/deep link, callback, recovery, and verification-result UI.
- [`src/modules/circle/`](src/modules/circle/) owns provider/Circle rules:
  - [`policy.js`](src/modules/circle/policy.js) computes effective policy and action decisions, including extension hooks.
  - [`modules.js`](src/modules/circle/modules.js) is the single registry for module families, toggles, dependencies, and settings links.
  - [`federation.js`](src/modules/circle/federation.js) builds/verifies uniqueness-ledger envelopes and hashes.
  - [`signingKeys.js`](src/modules/circle/signingKeys.js) validates, generates, hydrates, fingerprints, and exposes PEM signing keys.
  - [`ringRegistry.js`](src/modules/circle/ringRegistry.js) normalizes provider-blind settings, ring epochs/keys, audit roles, and cached gossip announcements.
- [`src/modules/admin/http/admin.js`](src/modules/admin/http/admin.js) and [`src/modules/admin/templates/admin.html`](src/modules/admin/templates/admin.html) own the install wizard, policy/settings, module control center, session overrides, governance decisions, topic review, federation operations, audit export, and ops summaries.

### Messaging, social, and notification kernel

- [`src/modules/home/`](src/modules/home/) owns `/` as an operational workspace, not a brochure or feed redirect.
- [`src/modules/discussion/`](src/modules/discussion/) owns attributed short discussion intake with evidence links and topic classification.
- [`src/modules/forum/`](src/modules/forum/) owns long-form topic threads and comments with evidence links.
  The searchable collection links to `/forum?thread=<id>`. Reply handlers accept visible Forum article ids and return to that article with the originating search and page.
- [`src/modules/messaging/`](src/modules/messaging/) contains internal notification persistence in [`notifications.js`](src/modules/messaging/notifications.js), contact/preference resolution and delivery logging in [`outbound.js`](src/modules/messaging/outbound.js), and pluggable delivery loading in [`transports.js`](src/modules/messaging/transports.js).
- [`src/modules/notifications/`](src/modules/notifications/) owns the paginated inbox, read/preferences routes, human-readable event labels, and scope-checked proposal destinations.
- [`src/modules/social/`](src/modules/social/) owns the non-binding “small talk + info” lane:
  - [`posts.js`](src/modules/social/posts.js) creates/indexes posts, replies, mentions, tags, reshares, feeds, and ActivityPub ids.
  - [`followGraph.js`](src/modules/social/followGraph.js) manages typed `circle`/`interest`/`info`/`alerts` edges.
  - [`media.js`](src/modules/social/media.js) owns provider-local upload metadata, locks, view requests, reports, and moderation status.
  - [`notifications.js`](src/modules/social/notifications.js) notifies mentions, replies, direct recipients, and media authors.
  - [`http/social.js`](src/modules/social/http/social.js) and [`templates/`](src/modules/social/templates/) own `/social/*` request handling and SSR.

### Organization operations and personalizable structure

- [`src/modules/organization/organizationTemplate.js`](src/modules/organization/organizationTemplate.js) is the current illustrative organization-pressure view model. Its cases document UI contracts; they are not persisted workflow records.
- [`src/modules/organization/cases.js`](src/modules/organization/cases.js) owns source eligibility, case promotion, and acknowledgement. [`organization.js`](src/modules/organization/http/organization.js) and the [organization templates](src/modules/organization/templates/) serve the case queue at `/organization` and the illustrative layers at `?view=preview`.
- [`src/modules/structure/structureManager.js`](src/modules/structure/structureManager.js) fixes canonical profile fields and validates versioned provider-local schema/attribute extensions.
- [`src/modules/profile/`](src/modules/profile/) owns handle, optional provider fields, schema-drift cues, topic preferences, and per-session UI defaults.
- The coordination case store is created on the first promotion. Add advanced layer records as separate lazy stores keyed by case id.

### Civic governance and deliberation

- [`src/modules/petitions/`](src/modules/petitions/) owns proposals, structured outlines, evidence, collaborative revisions/diffs, signatures/quorum, stance-tagged comments, fact-check flags, argument maps, freeze/status transitions, and vote submission. [`signatures.js`](src/modules/petitions/signatures.js) owns quorum transitions; [`commentStance.js`](src/modules/petitions/commentStance.js) owns stance vocabulary.
- [`src/modules/votes/voteEnvelope.js`](src/modules/votes/voteEnvelope.js) builds and verifies signed vote envelopes, including provider-blind placeholders.
- [`src/modules/governance/constitution.js`](src/modules/governance/constitution.js) owns constitution defaults, community change proposals, admin decisions, history, and diffs; [`src/modules/governance/http/`](src/modules/governance/http/) and [`templates/`](src/modules/governance/templates/) own `/governance`.
- [`src/modules/delegation/delegation.js`](src/modules/delegation/delegation.js) owns direct/advisory resolution, transitive chains, cycle/depth/ban guards, decay, renewal, and overrides. [`delegatedBallots.js`](src/modules/delegation/delegatedBallots.js) owns delegated-ballot resolution, the delegate vote window, vote tallying, and the delegate/owner ballot lists. [`delegateProfiles.js`](src/modules/delegation/delegateProfiles.js) builds advisory trust/profile summaries.
- [`src/modules/delegation/http/`](src/modules/delegation/http/) and [`templates/`](src/modules/delegation/templates/) own the preference/conflict/chain UI; [`src/modules/delegates/`](src/modules/delegates/) owns the searchable People directory and delegate profiles.
- [`src/modules/groups/`](src/modules/groups/) owns membership/roles in [`groups.js`](src/modules/groups/groups.js), independent group rules and lane toggles in [`groupPolicy.js`](src/modules/groups/groupPolicy.js), ranked delegate elections in [`groupElections.js`](src/modules/groups/groupElections.js), nesting in [`groupTree.js`](src/modules/groups/groupTree.js), lane scope/visibility in [`groupScope.js`](src/modules/groups/groupScope.js), upper-level moves in [`promotion.js`](src/modules/groups/promotion.js), delegate discovery in [`categoryDirectory.js`](src/modules/groups/categoryDirectory.js), and the `/groups` controller/templates. The controller resolves preferred-delegate and election-candidate inputs from `@handle` (or raw hash) to the canonical blinded hash, and renders delegates/candidates/winners as `@handle` — never as raw hashes.

### Topics and gardener worker

- [`src/modules/topics/classification.js`](src/modules/topics/classification.js) is the single classification entry point for extension and gardener providers.
- [`registry.js`](src/modules/topics/registry.js) persists topic ids/paths/history and applies rename/merge/split operations.
- [`preferences.js`](src/modules/topics/preferences.js) stores user/person-picked top categories; [`topicMatch.js`](src/modules/topics/topicMatch.js) builds the narrowest-first match keys that topic-scoped preferences (delegations, group cachets, elections) resolve against.
- [`topicGardenerClient.js`](src/modules/topics/topicGardenerClient.js) owns anchors/pins, helper requests, and operation retrieval; [`gardenerSync.js`](src/modules/topics/gardenerSync.js) schedules reviewed synchronization.
- [`src/infra/workers/topic-gardener/server.py`](src/infra/workers/topic-gardener/server.py) is the Python helper boundary. Node code calls the client instead of embedding ML logic or asking multiple providers independently. See its [worker README](src/infra/workers/topic-gardener/README.md) and [principle design](principle-docs/DynamicTopicCategorization.md).

### Federation, audit, extensions, and operations

- [`src/modules/federation/`](src/modules/federation/) separates protocol responsibilities:
  - [`activitypub.js`](src/modules/federation/activitypub.js) maps local social posts to actors/notes/activities and normalizes inbound notes.
  - [`canonical.js`](src/modules/federation/canonical.js) provides stable envelope canonicalization.
  - [`capabilities.js`](src/modules/federation/capabilities.js) fingerprints and caches peer module/data-mode snapshots.
  - [`gossip.js`](src/modules/federation/gossip.js) schedules parallel push/pull sync and maintains bounded optional/push endpoint skip caches.
  - [`ingest.js`](src/modules/federation/ingest.js) validates and persists ledger/vote gossip.
  - [`peers.js`](src/modules/federation/peers.js) normalizes and collects peer hints.
  - [`quarantine.js`](src/modules/federation/quarantine.js) scores peer health, ledger matches/mismatches, quarantine, and reset summaries.
  - [`replication.js`](src/modules/federation/replication.js) resolves data profiles, preview acceptance, provenance stamping, gossip enablement, and visibility filtering.
- [`src/modules/transactions/registry.js`](src/modules/transactions/registry.js) is the append-only local audit registry and signed summary verifier; [`gossip.js`](src/modules/transactions/gossip.js) exchanges bounded summaries for reconciliation.
- [`src/modules/extensions/registry.js`](src/modules/extensions/registry.js) loads and lifecycle-manages provider-local extensions; [`sample-policy-tighten.js`](src/modules/extensions/sample-policy-tighten.js) is the minimal policy-hook example.
- [`src/modules/ops/metrics.js`](src/modules/ops/metrics.js) records module-disabled/rate-limit counters and bounded operational snapshots.

### Persistence and adapters

- [`src/infra/persistence/storage.js`](src/infra/persistence/storage.js) initializes/hydrates state and exposes per-domain persistence functions. It is the application-facing persistence boundary.
- [`src/infra/persistence/store.js`](src/infra/persistence/store.js) selects an adapter from configuration.
- [`src/infra/persistence/migrations.js`](src/infra/persistence/migrations.js) is the ordered schema migration chain. Every persisted-shape change needs an idempotent migration and restart coverage.
- [`src/infra/persistence/adapters/index.js`](src/infra/persistence/adapters/index.js) is the adapter registry.
- Adapter implementations: [`json.js`](src/infra/persistence/adapters/json.js) for default file persistence, [`memory.js`](src/infra/persistence/adapters/memory.js) for ephemeral tests/dev, [`kv.js`](src/infra/persistence/adapters/kv.js) for a file-backed key/value store, [`sql.js`](src/infra/persistence/adapters/sql.js) for SQLite, [`mysql.js`](src/infra/persistence/adapters/mysql.js), and [`mongodb.js`](src/infra/persistence/adapters/mongodb.js).
- [`src/data/`](src/data/) is runtime state, not source. JSON/SQLite data, media, uploads, and `.local/` artifacts are ignored; do not use generated state as a fixture or commit it.

### Templates, browser behavior, and shared utilities

- [`src/modules/core/templates/`](src/modules/core/templates/) contains the layout, shell/topbar/footer partials, error page, module-disabled page, and admin-required page.
- Module-owned HTML lives below each module's linked `templates/` directory; reusable fragments belong in `templates/partials/` and are included with `{{> name}}`.
- [`src/public/app.css`](src/public/app.css) is the shared responsive theme and component styling. It is built on an HSL semantic token layer in `:root` (`--primary-h/s/l` → `--primary*`, `--primary-ink`, `--background`, `--card`, `--muted-foreground`, `--border`, `--ring`, status/hairline/inset/marker/overlay families, a `--radius` scale, and density tokens), re-declared for the light palette under `:root[data-theme="light"]` and the `system` media query. Legacy hex var names (`--bg`, `--text`, `--highlight`, `--accent`, …) are aliased onto the tokens so component CSS resolves through them — do not reintroduce raw hex or theme-blind `rgba()` in components.
- [`src/interfaces/http/views/interfaceSettings.js`](src/interfaces/http/views/interfaceSettings.js) is the single source of truth for the member "Appearance"/"Sections" vocabulary (`ACCENT_KEYS`, `DENSITY_KEYS`, `THEME_KEYS`, `interfaceVocabulary`, `normalizeInterfaceSettings`, `normalizeHiddenSections`, `sanitizeSectionKey`). Both [`profile.js`](src/modules/profile/http/profile.js) and [`templates.js`](src/interfaces/http/views/templates.js) import it, and `templates.js` ships `interfaceVocabulary()` to the browser on the layout's `data-ui-vocabulary` attribute, so adding a key here reaches `app.js` with no second edit. The literals in `app.js` are a fallback for a pre-deploy body only — do not reintroduce them as the source.
- [`src/public/app.js`](src/public/app.js) owns partial navigation, enhanced forms, interface preferences, nav filtering, composer behavior, and DOM/text/style overrides. Preserve SSR operation when JavaScript is absent.
- [`src/shared/utils/http.js`](src/shared/utils/http.js) owns HTML/JSON/gzip/redirect/rate-limit responses; [`request.js`](src/shared/utils/request.js) owns bounded bodies, cookies, multipart streaming, and temp cleanup; [`text.js`](src/shared/utils/text.js) owns sanitization, escaping, evidence links, and byte formatting; [`pagination.js`](src/shared/utils/pagination.js), [`parse.js`](src/shared/utils/parse.js), and [`time.js`](src/shared/utils/time.js) own their cross-module primitives.

### Root scripts, samples, and generated documentation assets

- [`run-standalone.sh`](run-standalone.sh) starts a full-feature local KV deployment, seeds an admin session, creates signing keys, and prints a login URL.
- [`scripts/user-journeys.js`](scripts/user-journeys.js) regression-drives the organization-operations flows (discussion → `/organization` → proposal → quorum → vote → groups → delegation) into `.local/journeys`. It is not README material: the product's demo face is Scenario A.
- [`scripts/party-journeys.js`](scripts/party-journeys.js) drives Scenario A (Rete Civica Nazionale) and is the source of every walkthrough capture (23, in `md-assets/party/`). All in-app copy is **English** — posts, proposals, group and category names — while names, handles, institutions, and legal citations stay Italian; topics are one English category tree (`Healthcare / Waiting lists`, …). It covers verified arrival, roles, the A.0 constitution and delegate bios; discussion, forum and social; a structured proposal revised by its own deliberation, quorum, argument-map rebuttal, attributed freeze and dissent; transitive delegation and a ranked election won on transfers; branch structure, the category directory, members-only lanes and promotion requests; pending delegated ballots and the delegate inbox; People/accountability; and a member-proposed constitutional change. It asserts each transition with an isolated browser context per member. Use `npm run screenshots:readme` to refresh the linked README images. Its `visit()` waits for `load` then network idle separately: `networkidle0` inside `goto()` drops intermittently across many browser contexts.
- [`scripts/readme-screenshots.js`](scripts/readme-screenshots.js) boots an isolated strict-Circle Scenario A on a temporary loopback port, drives the full browser walkthrough, and checks the README image links before copying the captures into `md-assets/party/`.
- [`scripts/seed-demo.js`](scripts/seed-demo.js) seeds a running deployment with a compact, unasserted English slice of Scenario A for manual review and `ui-screenshots.js`; it is never a substitute for the asserted replay.
- [`scripts/ui-screenshots.js`](scripts/ui-screenshots.js), [`ui-smoke.js`](scripts/ui-smoke.js), and [`ui-composer-smoke.js`](scripts/ui-composer-smoke.js) exercise route screenshots, layout, interactions, and Composer behavior.
- [`scripts/agent-viewport.js`](scripts/agent-viewport.js) and its [usage guide](scripts/agent-viewport.md) help agents inspect the live SSR UI.
- [`scripts/db-check.js`](scripts/db-check.js) reports adapter/storage health; [`scripts/circle-keygen.js`](scripts/circle-keygen.js) generates Circle signing/ring identity material.
- [`dev-samples/`](dev-samples/) contains Composer and social/forum template references. [`md-assets/`](md-assets/) contains README media, not runtime assets.
- [`thirds/citizenos-fe`](thirds/citizenos-fe) pins the upstream Citizen OS frontend for UI research. Keep it outside runtime, build inputs, and test discovery. Implement local UI work in the module templates, shared helpers, and first-party assets.

## Route Ownership Map

The exact table is [`src/app/router.js`](src/app/router.js). Use this map to find the first controller to inspect:

- `/`, `/organization`, `/discussion`, `/forum`, `/social/*`, `/notifications`, `/profile`: the matching module under [`src/modules/`](src/modules/).
- `/petitions*`, `/governance*`, `/delegation*`, `/delegates*`, `/groups*`: the matching civic module under [`src/modules/`](src/modules/).
- `/auth/eudi`, `/auth/callback`: [`src/modules/auth/http/auth.js`](src/modules/auth/http/auth.js).
- `/admin`, `/admin/audit`: [`src/modules/admin/http/admin.js`](src/modules/admin/http/admin.js).
- `/extensions`: [`src/interfaces/http/controllers/extensions.js`](src/interfaces/http/controllers/extensions.js).
- `/circle/gossip`, `/circle/ledger`, `/circle/peers`: [`src/interfaces/http/controllers/circle.js`](src/interfaces/http/controllers/circle.js).
- `/votes/ledger`, `/votes/gossip`: [`src/interfaces/http/controllers/votes.js`](src/interfaces/http/controllers/votes.js).
- `/transactions*`: [`src/interfaces/http/controllers/transactions.js`](src/interfaces/http/controllers/transactions.js).
- `/ap/*`: [`src/interfaces/http/controllers/activitypub.js`](src/interfaces/http/controllers/activitypub.js) plus [`src/modules/federation/activitypub.js`](src/modules/federation/activitypub.js).
- `/health`: [`src/interfaces/http/controllers/health.js`](src/interfaces/http/controllers/health.js); `/public/*`: [`static.js`](src/interfaces/http/controllers/static.js).

## Build, Run, and Test Checklist

Prerequisite: Node.js 20+ and npm.

```bash
npm install
npm start
./run-standalone.sh
```

Use an ephemeral messaging deployment when persistent state is irrelevant:

```bash
DATA_ADAPTER=memory DATA_MODE=centralized npm start
```

Validation commands:

```bash
npm test          # first-party tests/*.test.js, including Puppeteer UI flows
npm run test:ui   # stable UI-only entry point
npm run db:check  # adapter report
npm run keys:circle
```

Important test ownership:

- Identity/policy/admin: [`tests/auth.test.js`](tests/auth.test.js), [`policy.test.js`](tests/policy.test.js), [`admin-authorization.test.js`](tests/admin-authorization.test.js), [`install-wizard.test.js`](tests/install-wizard.test.js), and handle/person/rate-limit tests.
- Module and UX contracts: [`tests/modules.test.js`](tests/modules.test.js), [`ui.test.js`](tests/ui.test.js), [`consistency.test.js`](tests/consistency.test.js), [`verbosity.test.js`](tests/verbosity.test.js), [`control-theming.test.js`](tests/control-theming.test.js), and [`agent-viewport.test.js`](tests/agent-viewport.test.js).
- Organization/civic flows: [`tests/organization-cases.test.js`](tests/organization-cases.test.js), [`tests/organization-template.test.js`](tests/organization-template.test.js), petition/signature/status/evidence/comment tests, governance tests, delegation tests ([`delegated-ballots.test.js`](tests/delegated-ballots.test.js) covers resolution/window/lapse/override/cycle and the legacy-vote migration; [`topic-match.test.js`](tests/topic-match.test.js) covers hierarchical matching), delegate-profile tests, and group/election/recommendation tests under [`tests/`](tests/) ([`group-structure.test.js`](tests/group-structure.test.js) covers nesting, lane visibility, scope isolation and promotion refusals; [`group-roles-promotion.test.js`](tests/group-roles-promotion.test.js) covers lane-moderator boundaries, promotion requests/decisions, and branch-election roll-up).
- Social/messaging: discussion/forum evidence tests, notification tests, [`social.test.js`](tests/social.test.js), [`social-media.test.js`](tests/social-media.test.js), [`follow-graph.test.js`](tests/follow-graph.test.js), multipart/upload cleanup tests, and outbound-delivery tests.
- Persistence: [`tests/migrations.test.js`](tests/migrations.test.js), [`external-adapters.test.js`](tests/external-adapters.test.js), [`structure.test.js`](tests/structure.test.js), and restart coverage inside the UI suite.
- Federation/audit: ActivityPub, p2p, replication, gossip policy/capability/skip-cache, provider-blind, signing-key, vote-envelope/gossip, transactions, metrics, and gzip tests under [`tests/`](tests/).
- Shared test server, HTTP, auth, and ActivityPub fixtures live in [`tests/helpers/`](tests/helpers/).

External MySQL/MongoDB tests are opt-in through `TEST_MYSQL_*` and `TEST_MONGO_*`. MySQL-backed UI restart coverage also verifies persisted module settings and disabled-endpoint behavior when configured.

## Principle and Research Map

- [OrganizationPressureManagement.md](principle-docs/OrganizationPressureManagement.md): normative communication-first organization model, invariants, adoption staircase, voice/visibility, pressure dynamics, authority, money, mediation, canonical case contract, rollout, and non-goals.
- [RepresentativeParties.md](principle-docs/RepresentativeParties.md): optional civic philosophy and long-form rationale for identity, deliberation, delegation, voting, accountability, security, and phygital inclusion.
- [SimulationScenarios.md](principle-docs/SimulationScenarios.md): executable/design reference for Scenario A (civic) and Scenario B (ASL organization operations), including casts, fixtures, assertions, status labels, and coverage map.
- [UIReview.md](principle-docs/UIReview.md): standing UI-evaluation procedure and checklist — run Scenario A and hold every member-facing screen to the "real forum/social product" bar whenever presentation changes.
- [Provider-Blind-Mode.md](principle-docs/Provider-Blind-Mode.md): threat model, candidate protocols, current scaffold, draft envelope shapes, audit quorum, and open questions.
- [DynamicTopicCategorization.md](principle-docs/DynamicTopicCategorization.md): online classification plus reviewed background gardener design.
- [Author-Notes.md](principle-docs/Author-Notes.md): product reminders and historical TODOs. Reconcile its notes with the normative documents and roadmap before treating them as requirements.

## Current Status and Roadmap Snapshot

Keep this section aligned with [ROADMAP.md](ROADMAP.md); that document is authoritative for detail.

### Shipped baseline

- The messaging/forum/notification kernel, operational home, typed-follow social feed, provider-local media controls, handles/roles/bans/rate limits, SSR/partial navigation, and UI preference controls are live.
- Petitions, revisions, evidence, quorum, staged deliberation/freeze/voting, vote envelopes, transactions, governance defaults/proposals, delegate profiles, transitive delegation, decay/renewal, pending delegated ballots with a delegate deadline/inbox, and member overrides are implemented.
- Groups support guarded branch nesting, independently declared categories and delegate discovery, optional internal discussion/proposal lanes, lane-moderator roles, promotion requests and move-with-history promotion, and opt-in branch-election roll-up. Nesting remains structural and never grants inherited authority or membership.
- Module families/toggles, extension lifecycle, provider-local profile schemas, topic registry/preferences/gardener review, persistence adapters/migrations, data profiles, gossip scheduling, peer capabilities/health/quarantine, and ops cues are present.
- Provider-blind settings, ring registry announcements, and `ringSignature` fields are scaffolding. They do not provide complete provider anonymity.
- `/organization` supports discussion-based case promotion, searchable history, and attributed acknowledgements with review dates. Advanced layer records are represented in the separate workspace preview.

### Near-term priorities

1. Extend the case kernel to shared email intake and tracked response times while retaining the source message as canonical.
2. Design and implement the separate audited protected-voice path before making anonymity claims.
3. Add lazy, versioned stores for commitments, flow edges, authority, funds, sectors, mediation, pressure observations, and impact reviews.
4. Introduce explainable aggregate pressure analytics with cohort suppression and no automated sanctions.
5. People profiles (GET views), governance changes (current rule beside proposed value), and the organization case record follow the header–sections–context pattern. Proposal browse and the four proposal record views use the same stored-lane checks as writes. Profile, the wallet handoff/result/recovery pages, and the organization preview header are converted; settings forms report through [`formFeedback.js`](src/interfaces/http/views/formFeedback.js). Next: admin settings in the same pattern, People pagination, notification sources beyond proposals, and Composer component work after the shared variants settle. [UI roadmap](UI_ROADMAP.md#8-delivery-order-and-acceptance)
6. Harden federation, cross-provider civic visibility, replication tests, provider-blind signatures/escrow/reveal governance, and eventual Claim & Seize migration.
7. Evaluate libp2p gossipsub for bounded, signed social-lane replication while preserving audit-grade civic envelopes.

## Task Start Checklist

Before implementing:

1. Identify the owning module/controller/template in the linked tree and inspect its focused tests.
2. Check the relevant product principle, module toggle/dependencies, policy/admin gate, and user/person vocabulary.
3. Decide which data is canonical, provider-local, preview/validated, transactional, or safe to gossip.
4. Preserve SSR without JavaScript and verify full versus partial HTML behavior.
5. Use shared actor labels, context panels, status/preview pills, pagination, sanitization, and persistence helpers instead of local duplicates.
6. Add or update migrations and restart tests for persisted-shape changes.
7. Exercise the relevant canonical simulation rather than inventing placeholder actors/content.
8. Run focused tests, then the appropriate broader suite; update README/roadmap/AGENTS and record any new optimization.

## Contact and License

- Project owner: Riccardo Cecchini.
- License: [GPL-3.0-or-later](LICENSE).
