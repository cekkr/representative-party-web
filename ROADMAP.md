This roadmap aligns the build with the Representative Parties thesis (see principle-docs/RepresentativeParties.md) and keeps EUDI/OIDC4VP at the core while leaving enforcement policy-driven per Circle. Near-term priority is an operative social network with verified citizens, privileges, and durable data flows; deep protocol polish follows once users can actually interact.

## Anchoring Principles (from Representative Parties)
- **One Citizen, One Voice** backed by blinded identity; federation guards against double representation and toxic providers.
- **Soft-power accountability**: transparency and auditable trails instead of hard imperative mandates.
- **Liquid representation**: delegation is topic-scoped, revocable, and visible; citizens can migrate without losing history.
- **Phygital inclusion**: the digital platform must remain accessible via desktop/mobile and be mirrored by physical “agorà” touchpoints.

## Architecture Baseline (Phase 1 kernel)
- **Modular NodeJS monolith**: http server under `src/` with route handlers in `src/routes/`, shared services in `src/services/`, storage in `src/state/`, and view helpers in `src/views/`.
- **Identity & Sessions**: OIDC4VP verifier scaffold (EUDI wallet offer/callback) with blinded PID hashing and signed cookie session.
- **Persistence**: JSON store (ledger, sessions, peers, discussions, actors) under `src/data/` with pluggable upgrade path.
- **Federation seeds**: ActivityPub actor emitter, inbox placeholder, gossip endpoints for peer/ledger sync.
- **Frontend shell**: SSR templates + vanilla router interceptor (partial HTML) with wallet handoff UI and discussion sandbox.

## UX Baseline (to harden during Phase 1)
- Clear entry points: CTA for “Verify with EU Wallet” and “Start debating” with copy that explains privacy (hash-only, no PII stored).
- Deep link / QR duality: desktop shows QR + copyable link; mobile prioritizes direct handoff.
- Accountability cues: show verified handle, ledger count, and Circle policy status on every page frame.
- Error/edge flows: graceful partial responses for session issues; offline-friendly offer preview and retry CTA.
- Accessibility: keyboard-friendly forms, high-contrast defaults, and no client-side blocking for SSR-first paths.

## Implementation Roadmap

### Phase 1 — Operative Social Network & Circle Policy (Months 1-4)
- Bind verified sessions to handles/profiles and roles (citizen/moderator/delegate), and enforce Circle policy for posting/petition/vote with visible status in the UI and `/health`.
- Model and validate data exchanges: persisted discussions/petitions/votes tied to session hashes, with rate limits, quorum/ban checks, and audit-friendly logs.
- Add signed vote envelopes and gossip endpoints (`/votes/ledger`, `/votes/gossip`) so auto-delegated votes are verifiable across providers and resistant to injection/replay.
- Extract persistence behind an interface (JSON today, pluggable DB tomorrow) with migrations for ledger/sessions/discussions/petitions/votes to keep user data durable.
- Keep identity foundations minimal-but-real: OIDC4VP/OpenID hash validation, key management, and QR/deep-link UX; defer deeper protocol details until the user/data flows are reliable.
- Federation stays stubbed (ActivityPub actor/inbox/outbox + ledger gossip placeholders) to avoid blocking local UX; hardening is a later phase.

### Phase 2 — Deliberation & Structure (Months 5-7)
- **Petitions module**: collaborative drafting with signature thresholds; signatures tied to verified sessions.
- **Topics/Taxonomy**: nested topics with usage-based promotion/pruning; identity-rate-limiting instead of CAPTCHA.
- **Group delegation & elections**: groups manage internal delegate cachets and elections; recommendations remain advisory, users can always override.
- UX: guided flows for “draft → discuss”, inline status chips (petition stage, quorum), and topic breadcrumbs.

### Phase 3 — Decision Engine (Months 8-11)
- **Voting module**: implement Schulze/Condorcet; split authentication (hash) from anonymized ballot storage.
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

This version places the **"Party Circle"** and **European Digital Identity (EUDI)** integration at the very core of the system. The architecture is designed to be modular: while the *capability* to verify EU Digital Identities via **OIDC4VP** is mandatory code in the framework, its *enforcement* is a policy setting configurable per "Circle" (mandatory for EU regions, optional for others). The first milestone is an operative network: verified citizens with handles, role-aware privileges, and end-to-end validated data flows; protocol depth and federation details harden afterward.

### **Technical Philosophy & Stack Overview**

  * **Backend:** **NodeJS**. Built as a modular monolith where the "Identity Verifier" is a distinct, swappable micro-service.
  * **Frontend:** **Hybrid SSR + Vanilla JS**.
      * **SEO:** Server-Side Rendering (SSR) for distinct URLs and indexing.
      * **Performance:** Vanilla JS "Router Interceptor" for an app-like feel (fetching partial HTML/JSON) without heavy framework bloat.
  * **Protocol:** **Federated (ActivityPub) + OIDC4VP**.
      * **Identity:** Decoupled. The server knows *that* you are a unique citizen, but not *who* you are.
      * **Federation:** "Party Circle" servers share a "Allow List" of trusted providers and sync user uniqueness hashes to prevent double-voting across the network.

-----

### **The "Party Circle" Module: The Constitution of Trust**

This is the new mandatory core layer. It defines the rules that bind different servers (Providers) into a trusted "Circle."

#### **1. The "Verifier" Role (OIDC4VP & EUDI)**

Instead of a traditional login (email/password), the framework acts as a **Verifier** using the **OpenID for Verifiable Presentations (OIDC4VP)** standard.

  * **The Flow:**
    1.  User clicks "Login with EU Wallet."
    2.  The server generates a QR Code / Deep Link requesting a **Unique Pseudonymous ID** (PID) from the user's EUDI Wallet.
    3.  **Privacy Logic:** The request explicitly asks *only* for a unique hash (e.g., `hash(NationalID + Salt)`), **not** the user's name or address.
    4.  **Zero-Knowledge Proof:** The wallet proves the user is a valid citizen of a specific region without revealing their identity to the server.
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
| **1. Party Circle (The Kernel)** | **Governance:** Manages OIDC4VP strategy, the "Uniqueness Ledger," and the list of federated peers. <br> **Policy:** Enforces the "One Citizen, One Voice" rule and handles "Toxic Provider" exclusion lists. |
| **2. Discussion (Agorà)** | **Debate:** Standard threads with "Pro/Con" structure. <br> **Policy:** linked to the verified identity (users cannot spam anonymously; they are accountable to their unique hash). |
| **3. Dynamic Topics (Ext.)** | **Organization:** Users create nested category trees (tags). <br> **Policy:** Topics evolve organically based on usage metrics. |
| **4. Petitions** | **Initiative:** Collaborative drafting of laws/proposals. <br> **Policy:** Git-like version control for text. Requires a signature threshold (Quorum) to move to Discussion. |
| **5. The Connector** | **Workflow:** Logic engine (Petition $\rightarrow$ Discussion $\rightarrow$ Vote). |
| **6. Voting** | **Decision:** Secure ballot box. <br> **Policy:** Vote masking. The database stores the vote linked to a temporary session ID, not the permanent User ID, ensuring secrecy. |
| **7. Delegates (Liquid Ext.)** | **Representation:** Extension for Voting. <br> **Policy:** Manages the graph of trust. Allows delegating votes to others, with transitive calculations (A $\to$ B $\to$ C). |

-----

### **Implementation Roadmap**

#### **Phase 1: The "Party Circle" Foundation (Months 1-4)**

*Goal: Build the NodeJS core that speaks OIDC4VP and ActivityPub.*

1.  **NodeJS & OIDC4VP Setup:**
      * Initialize the server (Fastify/Express).
      * Implement the **OIDC4VP Verifier**: Use libraries like `@sphereon/oid4vc-common` or `@credo-ts/openid4vc` to handle the handshake with EUDI Wallets.
      * **The "Blind" Token:** Create the logic to receive the Verifiable Presentation, validate the government signature, and hash the Subject ID for storage.
2.  **Federated Identity Registry:**
      * Build the `UserHash` table.
      * Implement the **ActivityPub Actor**: Every user is an Actor (`@hash@server.party`).
      * **Uniqueness Sync:** Create a "Gossip Protocol" where servers exchange hashes of new users to enforce uniqueness constraints.
3.  **Frontend Framework (SSR + Vanilla):**
      * Set up the template engine (EJS/Pug).
      * Build the "Deep Link" handler: A generic JS module that detects `openid-credential-offer://` links and triggers the user's installed EUDI Wallet app (or displays a QR code on desktop).

#### **Phase 2: Deliberation & Structure (Months 5-7)**

*Goal: Give the valid users a place to speak.*

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

*Goal: Liquid Democracy and Voting.*

1.  **Voting Module:**
      * Implement the **Schulze Method** for ranking options.
      * **Anonymity Layer:** Ensure that while *access* to the ballot box requires the OIDC4VP token, the *ballot itself* is stored in a separate table with no link back to the user hash.
2.  **Delegates Manager:**
      * Build the "Delegation Dashboard."
      * **Transitivity Engine:** A NodeJS worker that traverses the delegation graph (A delegates to B, B to C) to calculate the "Power Weight" of every user before a vote opens.
3.  **The Connector:**
      * Automate the pipeline: *Quorum Reached $\rightarrow$ Open Discussion $\rightarrow$ Freeze Text $\rightarrow$ Vote*.

#### **Phase 4: Federation Hardening & Migration (Months 12-14)**

*Goal: Ensure the "Party Circle" is robust against bad actors.*

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
