This roadmap aligns the build with the Representative Parties thesis (see principle-docs/RepresentativeParties.md) while framing the base as a messaging-first social network that existing orgs can adopt without heavy restructuring. Default actor is a user; “person” is a civic/party Circle label that signals a verified natural person (exclusion principle: org/bot/service accounts cannot hold handles). Near-term priority is an operable messaging layer with durable data and policy gates; deep protocol polish follows once users can actually interact.

## Anchoring Principles (from Representative Parties)
- **One person/person, One Voice** backed by blinded identity; federation guards against double representation and toxic providers. “Person” is a Circle-specific label layered on top of the user role when civic proof is enabled.
- **Exclusion principle**: only natural persons can hold handles or act; org/bot/service accounts are blocked via verification policy and banned flagging.
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
- **Frontend shell**: SSR templates + vanilla router interceptor (partial HTML) with wallet handoff UI and discussion sandbox.
- **Messaging surface first**: discussion/forum + notifications operate even when petitions/votes/delegation/federation are disabled; policy + extensions decide when to light up advanced modules.
- **Parallel social feed**: typed follows (circle/interest/info/alerts) power a Twitter-like micro-post lane with replies/mentions/tags/reshares and optional provider-local media uploads (locked by default, view-on-request, blockable after reports); kept distinct from petitions/votes/forum flows so authority never derives from follows.
- **Helper services**: external AI/ML workers (e.g., the topic gardener) live under `src/infra/workers/` as Python projects, exposed via cohesive APIs so Node callers avoid conflicting classification results and redundant calls.
- **UI coherence**: status strip in layout surfaces Circle enforcement + validation/preview state, ledger/actor/discussion counts, and gossip ingest state; templates stay extension-aware so toggled modules show/hide nav items and reuse shared badges for preview/provenance across discussion/social/petitions.

## Data topology & adapters
- Modes: `DATA_MODE=centralized` (single adapter, no gossip writes/ingest), `DATA_MODE=hybrid` (central canonical + p2p replicas/merkle audit), `DATA_MODE=p2p` (gossip-ledger primary with optional local cache). `DATA_VALIDATION_LEVEL` (`strict` | `observe` | `off`) and `DATA_PREVIEW` (allow/prevent preview storage) gate when uncertified data is stored or surfaced; `DATA_ADAPTER` selects the driver (`json` default, `memory` for ephemeral/local).
- Adapter map: drivers live under `src/infra/persistence/adapters/` with the selector in `src/infra/persistence/store.js`; replication/validation helpers live in `src/modules/federation/replication.js`. Domain modules call the interface, not the concrete adapter. SQLite-backed SQL and file-based KV adapters exist (SQL requires optional `sqlite3`); JSON/memory remain defaults.
- Phase alignment: Phase 1 ships the adapterized interface + JSON driver + replication profile stub; Phase 2 adds SQL/kv drivers and hybrid-mode wiring; Phase 4 tightens redundancy targets, quarantine, and cross-ring audits.

## UX Baseline (to harden during Phase 1)
- Clear entry points: CTA for “Verify with EU Wallet” and “Start debating” with copy that explains privacy (hash-only, no PII stored) and the natural-person exclusion principle when civic mode is on.
- Deep link / QR duality: desktop shows QR + copyable link; mobile prioritizes direct handoff.
- Accountability cues: show verified handle/person badge, ledger count, and Circle policy status on every page frame.
- Error/edge flows: graceful partial responses for session issues; offline-friendly offer preview and retry CTA.
- Actor labels: UI copy switches between “user” and “person” based on Circle enforcement (person only when civic/party mode is strict).
- Delegation UI: show election-winner metadata next to group recommendations so users understand why a suggestion was picked.
- Accessibility: keyboard-friendly forms, high-contrast defaults, and no client-side blocking for SSR-first paths.

## Adoption & Extension stance
- Start from messaging + notifications as the default value; petitions, votes, delegation, federation, and topic gardener are opt-in via policy/extension toggles so existing organizations can extend without being forced into the full Party Circle vision on day one. Core module toggles live in `/admin` and gate nav + endpoints.
- Providers can stay standalone or join a social/party Circle; policy gates and extensions keep behavior cohesive inside a provider and across a Circle when shared norms are desired.

## Implementation Roadmap

## Current status snapshot (Phase 1 largely shipped)
- Messaging kernel is live (discussion/forum/notifications) with SSR + partial HTML navigation.
- Social feed ships typed follows plus replies/mentions/tags/reshare and provider-local media uploads (locked by default, blockable after reports), gated by the same role/ban checks.
- Circle policy gates, session roles/ban flags, and identity-based rate limits are wired into posting flows.
- Petitions/signatures/votes pipeline exists with vote envelopes, collaborative revisions + version history, stage cues, transactions log + gossip summaries, and admin controls.
- Delegation + groups + elections (ranked-choice with second/third picks) are implemented and surfaced in UI.
- Persistence adapters (json/memory/sql/kv), data modes, preview gating, gossip scheduler, and peer health/quarantine are in place.
- Structure manager UI for provider-local fields and attributes is available, with schema-staleness cues on profile edits; topic preferences + topic registry/breadcrumbs + gardener worker with scheduled refactors and admin review for rename/merge/split + anchor suggestions are wired.
- Peer health now records peer ledger hash snapshots with match/mismatch cues for audits.

## Near-term next steps (Phase 2 focus)
- Extend topic gardener review with deeper diff visualization for topic history.
- Add petition revision diffs, review prompts, and pre-vote freeze UX so contributors can validate the final text before voting opens.
- Expand the structure manager: schema versioning, inline validation errors, and a per-session attributes editor that respects provider-only storage and consent.
- Wire outbound transports (email/SMS) with delivery logs and opt-in enforcement using provider-local preferences.
- Harden federation: ActivityPub inbox/outbox processing, cross-provider petition/vote visibility, and scaffolding for Claim & Seize migrations.
- Extend replication tests for hybrid/p2p modes (preview gating, policy mismatch quarantine, skipped optional endpoints).

### Phase 1 — Messaging Kernel & Circle Policy (Months 1-4)
- Deliver the messaging layer (discussion/forum/notifications) with handles and roles; OIDC4VP marks a session as “person” to enforce the natural-person exclusion principle where required, while allowing messaging to run in a lighter user-only mode.
- Add the follow graph + micro-post lane: typed follows (circle/interest/info/alerts) drive `/social/feed` with short posts + replies/mentions/reshares plus optional provider-local media uploads; keep UX copy explicit that this lane is for small talk/info and gated by the same role/ban checks as discussions.
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
- **Petitions module**: collaborative drafting with signature thresholds; signatures tied to verified sessions.
- **Topics/Taxonomy**: nested topics with usage-based promotion/pruning; users (people when civic proof is on) select top categories while admins/policy voters can pin mandatory/legal/departmental anchors; identity-rate-limiting instead of CAPTCHA.
- **Personalizable structure manager**: admin schema/data-table editor for provider-local optional fields/tables while locking canonical account fields (handle + credential/wallet binding, role/banned flag, blinded hash). Optional contact data (email/notifications) remains local and fuels provider-owned delivery/consent flows; example: handle + password stays required even when email is optional.
- **Topic gardener helper**: implement the DynamicTopicCategorization flow (online ingestion + scheduled merge/split/rename) as a Python service in `src/infra/workers/`, exposed via a stable API to `src/modules/topics/classification.js` so multiple providers stay reconciled (no conflicting labels) and redundant processing is avoided. Use it to surface trends, aggregate dispersed discussions, and pull isolated clusters toward active threads.
- **Group delegation & elections**: groups manage internal delegate cachets and elections; recommendations remain advisory, users can always override. Conflict rules can require user choice instead of auto-selection, and vote-mode recommendations should prefer the latest closed election winner.
- UX: guided flows for “draft → discuss”, inline status chips (petition stage, quorum), and topic breadcrumbs.

### Phase 3 — Decision Engine (Months 8-11)
- **Voting module**: implement Schulze/Condorcet; split authentication (hash) from anonymized ballot storage.
- **Ranked-choice ballots (person elections)**: group delegate elections already capture up to three preferences with multi-round transfers (Alaska-style); extend the same ranked-choice capture to the core voting module when it lands.
- **Delegation graph**: revocable, topic-scoped delegation with decay/visibility rules; worker to compute power weights.
- UX: ballot clarity (options, ranking helper), delegation previews, and “explain my influence” summaries.

### Phase 4 — Federation Hardening & Migration (Months 12-14)
- **Claim & Seize** protocol: signed migration requests to move history across providers when the same wallet re-verifies.
- **Circle health**: scheduled peer audits for policy compliance; automatic quarantine of toxic peers.
- UX: migration status banners and audit transparency dashboard.

### Phase 5 — Launch Polish (Months 15+)
- SEO metadata for petitions/proposals; schema.org generation server-side.
- EUDI compliance audit against eIDAS 2.0/ARF.
- Mobile-first refinements for app-switch flows and QR fallback, plus public trust dashboards for accountability.

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
| **3. Dynamic Topics (Ext.)** | **Organization:** Users create nested category trees (tags). <br> **Policy:** Topics evolve organically based on usage metrics. |
| **4. Petitions (Ext.)** | **Initiative:** Collaborative drafting of laws/proposals. <br> **Policy:** Git-like version control for text. Requires a signature threshold (Quorum) to move to Discussion. |
| **5. The Connector** | **Workflow:** Logic engine (Petition $\rightarrow$ Discussion $\rightarrow$ Vote). |
| **6. Voting** | **Decision:** Secure ballot box. <br> **Policy:** Vote masking. The database stores the vote linked to a temporary session ID, not the permanent User ID, ensuring secrecy. |
| **7. Delegates (Liquid Ext.)** | **Representation:** Extension for Voting. <br> **Policy:** Manages the graph of trust. Allows delegating votes to others, with transitive calculations (A $\to$ B $\to$ C). |

-----

### **Implementation Roadmap**

#### **Phase 1: Messaging Kernel & Civic Hooks (Months 1-4)**

*Goal: Build the messaging kernel with optional OIDC4VP/ActivityPub civic Circle hooks.*

1.  **NodeJS & OIDC4VP Setup:**
      * Initialize the server (Fastify/Express).
      * Implement the **OIDC4VP Verifier**: Use libraries like `@sphereon/oid4vc-common` or `@credo-ts/openid4vc` to handle the handshake with EUDI Wallets.
      * **The "Blind" Token:** Create the logic to receive the Verifiable Presentation, validate the government signature, and hash the Subject ID for storage.
      * Keep verifier enforcement behind a policy toggle so messaging-only deployments can run without civic proof while still supporting the exclusion principle when enabled.
2.  **Federated Identity Registry:**
      * Build the `UserHash` table.
      * Implement the **ActivityPub Actor**: Every user is an Actor (`@hash@server.party`) with outbox stubs plus preview-gated inbox ingestion.
      * **Uniqueness Sync:** Create a "Gossip Protocol" where servers exchange hashes of new users (with ledger digests) to enforce uniqueness constraints when Circle mode is enabled.
3.  **Frontend Framework (SSR + Vanilla):**
      * Set up the template engine (EJS/Pug).
      * Build the "Deep Link" handler: A generic JS module that detects `openid-credential-offer://` links and triggers the user's installed EUDI Wallet app (or displays a QR code on desktop).
4.  **Messaging baseline:**
      * Ship SSR discussion/forum surfaces and the notification registry as the default value even without petitions/votes enabled.
      * Keep handles/roles visible so policy can later enforce the person-only exclusion principle without reworking the UX.

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

#### **Phase 3: The Decision Engine (Months 8-11)**

*Goal: Provide Liquid Democracy and Voting where the Circle enables it.*

1.  **Voting Module:**
      * Implement the **Schulze Method** for ranking options.
      * **Anonymity Layer:** Ensure that while *access* to the ballot box requires the OIDC4VP token, the *ballot itself* is stored in a separate table with no link back to the user hash.
2.  **Delegates Manager:**
      * Build the "Delegation Dashboard."
      * **Transitivity Engine:** A NodeJS worker that traverses the delegation graph (A delegates to B, B to C) to calculate the "Power Weight" of every user before a vote opens.
3.  **The Connector:**
      * Automate the pipeline: *Quorum Reached $\rightarrow$ Open Discussion $\rightarrow$ Freeze Text $\rightarrow$ Vote*.

#### **Phase 4: Federation Hardening & Migration (Months 12-14)**

*Goal: When Circle mode is enabled, ensure the federation is robust against bad actors.*

1.  **Provider Migration Protocol:**
      * Implement the **"Claim & Seize"** API. If a user logs into *Server B* with the same EUDI Wallet used on *Server A*, *Server B* sends a signed request to *Server A* to transfer the user's post history and delegation settings.
2.  **Circle Health Checks:**
      * **Policy Verification:** Servers periodically audit each other (e.g., checking if they are correctly enforcing OIDC4VP checks). If a server fails, it is automatically removed from the "Trusted Circle," isolating the toxic provider.
3.  **Cross-Provider Access:**
      * Allow a user on *Server A* to view and vote on a Petition hosted on *Server B* seamlessly, using the ActivityPub federation to transport the vote authentication.

#### **Phase 5: Polish & Launch (Months 15+)**

1.  **SEO & Indexing:** Ensure every Petition and Proposal has valid Schema.org metadata generated server-side.
2.  **EUDI Compliance Audit:** Verify the implementation against the final **eIDAS 2.0 / ARF** technical specifications to ensure the wallet integration is legally compliant for EU regions.
3.  **Mobile Optimization:** Refine the Vanilla JS interactions to ensure the OIDC4VP app-switching flow works smoothly on iOS and Android devices.
