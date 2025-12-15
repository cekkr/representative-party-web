This file contains every essential directive of the project, its essential code references to allow fast representation of the code structure without doing researches every time and considered next steps to implement. Should be updated at every change with the human-readable README.md. The core philosophy of the project is contained at principle-docs/RepresentativeParties-Ita.pdf, but the project language is english. In ROADMAP.md is contained the essential development line.

The code (server and public) has to be allocated in src/ folder.

## Current implementation snapshot (Phase 1 kick-off)

- Server entrypoint: `src/index.js`
  - Lightweight HTTP server (no external deps) with SSR-first rendering and partial responses when `X-Requested-With: partial`.
  - Mock OIDC4VP verifier:
    - `GET /auth/eudi` creates a pending session (salted) and emits a deep-link style credential offer for wallet handoff.
    - `GET /auth/callback?session={id}&pidHash=...` (or `&pid=...`) blinds the PID (`sha256(pid:salt)`), marks the session verified, and records the hash.
  - In-memory Uniqueness Ledger (`Set` of hashed PID values) plus future peer placeholder.
  - Static asset serving from `src/public`.
- Frontend shell: SSR HTML with a vanilla router interceptor for app-like navigation and a deep-link trigger for wallet flows (client JS in `src/public/app.js`).
- Templates: `src/public/templates` (layout + pages for home, auth, verification, error).
- Styles: `src/public/app.css` hosts the initial visual system (gradient background, CTA styles, cards).

## Endpoints (today)

- `/` — landing page, SSR + partial compatible.
- `/auth/eudi` — start the credential offer (deep link).
- `/auth/callback` — mock verifier callback, records the blinded PID hash.
- `/health` — JSON health/metrics (ledger size, sessions, peers).
- `/public/*` — static assets.

## Immediate next steps (per ROADMAP.md)

1. Swap mock verifier with a real OIDC4VP implementation and add QR generation for desktop.
2. Emit ActivityPub actors per verified hash and prepare a gossip endpoint to sync the Uniqueness Ledger across peers.
3. Persist the ledger/sessions to durable storage and add policy toggles for Circle enforcement.
4. Create a basic usable interface with discussion module to allow practical testing

## Essential future steps:
- If every provider has its layout but adapts shared data, is needed also a "module signing" certification for essential operations, and a cohesive protocol to avoid mismanagement of sensitive shared operations (for example, vote counting, in this case random redundancies are essential for validation too)
