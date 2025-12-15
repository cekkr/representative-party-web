This file contains every essential directive of the project, its essential code references to allow fast representation of the code structure without doing researches every time and considered next steps to implement. Should be updated at every change with the human-readable README.md. The core philosophy of the project is contained at principle-docs/RepresentativeParties-Ita.pdf, but the project language is english. In ROADMAP.md is contained the essential development line.

The code (server and public) has to be allocated in src/ folder.

## Current implementation snapshot (Phase 1 kernel + UI)

- Server entrypoint: `src/index.js`
  - SSR-first HTTP server with partial responses when `X-Requested-With: partial`.
  - OIDC4VP verifier scaffold with QR deep-linking:
    - `GET /auth/eudi` issues a credential offer (deep link + QR) and stores a salted pending session.
    - `GET /auth/callback?session={id}&pidHash=...` (or `&pid=...`) blinds the PID (`sha256(pid:salt)`), marks the session verified, mints an ActivityPub actor, and persists to the ledger.
  - Persistence: ledger, sessions, peers, actors, and discussions saved under `src/data/` (JSON). `.gitignore` excludes those JSON files; a `.gitkeep` pins the folder.
  - Circle policies: `POLICIES` enforce verification-first posting; `ENFORCE_CIRCLE=true` flag is wired for future strict mode.
  - Gossip + federation stubs:
    - `POST /circle/gossip` to accept ledger hashes from peers.
    - `GET/POST /circle/peers` to list/register peers; `GET /circle/ledger` exports the ledger.
    - ActivityPub actor emission at `/ap/actors/{hash}`; placeholder inbox at `/ap/inbox`.
- Frontend:
  - SSR HTML shell (`layout.html`) with vanilla router interceptor (`src/public/app.js`), supporting partial navigation and enhanced form posting.
  - Wallet handoff UI with deep-link trigger + QR preview, offer payload preview.
  - Discussion sandbox (`/discussion`) with form-enhanced posting, rendering threads tied to verified sessions.
- Templates: `src/public/templates` (layout, home, auth-eudi, verification-complete, error, discussion).
- Styles: `src/public/app.css` updated with QR, discussion, and form styles.

## Endpoints (today)

- `/` — landing page with stats (ledger, actors, discussions) and CTA links.
- `/auth/eudi` — start credential offer (deep link + QR).
- `/auth/callback` — mock verifier callback, records blinded PID hash, sets session cookie, emits ActivityPub actor.
- `/discussion` — GET renders threads; POST appends a post (verified session enforced by policy).
- `/circle/gossip` — ingest ledger hashes from peers.
- `/circle/ledger` — export ledger entries (JSON).
- `/circle/peers` — list or register peer hosts.
- `/ap/actors/{hash}` — ActivityPub actor descriptor for each hash.
- `/ap/inbox` — placeholder inbox (202 ACK).
- `/health` — JSON health/metrics (ledger size, sessions, actors, peers, discussions).
- `/public/*` — static assets.

## Immediate next steps (per ROADMAP.md)

1. Swap the scaffold with a real OIDC4VP implementation, validate VPs cryptographically, and manage verifier keys; keep QR generation but offer an offline/local generator.
2. Upgrade ActivityPub: implement signed inbox/outbox deliveries, publish actors/ledger updates to peers, and add a gossip scheduler for uniqueness sync.
3. Harden persistence (pluggable store beyond JSON), add policy toggles for Circle enforcement, and evolve the discussion sandbox toward petitions → debate → vote.

## Essential future steps:
- If every provider has its layout but adapts shared data, is needed also a "module signing" certification for essential operations, and a cohesive protocol to avoid mismanagement of sensitive shared operations (for example, vote counting, in this case random redundancies are essential for validation too)
