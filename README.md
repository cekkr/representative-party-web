# Representative Party Framework

Prototype implementation of the Representative Party "Party Circle" kernel. Phase 1 now ships a QR-friendly OIDC4VP offer scaffold, a persisted Uniqueness Ledger, ActivityPub actor emission, and a discussion sandbox bound to verified sessions.

## Quick start

```bash
npm install # no external deps today, keeps package-lock current
npm test    # node --test suite (hashing, migrations, policy gates)
npm start
```

- Server defaults to `http://0.0.0.0:3000`.
- Persisted state is stored under `src/data/` (ledger, sessions, discussions, peers, actors).

## What exists

- SSR HTML shell with a small vanilla router interceptor (no SPA), delivering partial responses when requested with `X-Requested-With: partial`.
- OIDC4VP verifier scaffold with QR handoff:
  - `GET /auth/eudi` issues a credential offer deep link + desktop QR and stores a salted pending session.
  - `GET /auth/callback?session={id}&pidHash=...` or `&pid=...` finalizes verification, writes the blinded PID hash to the ledger, mints an ActivityPub actor, and sets a session cookie.
- Persistent "Uniqueness Ledger" plus circle sync hooks:
  - Ledger + sessions + peers are saved to `src/data/`.
  - `POST /circle/gossip` accepts hashes from peers; `GET /circle/ledger` exports entries; `GET/POST /circle/peers` manages peer hints.
- ActivityPub + federation stubs:
  - `GET /ap/actors/{hash}` exposes an actor descriptor.
  - `POST /ap/inbox` accepts incoming federation payloads (placeholder).
- Discussion sandbox tied to verified citizens:
  - `GET /discussion` renders the thread list; `POST /discussion` appends a post using the verified session cookie when policies enforce it.
- Health endpoint (`GET /health`) reports ledger/sessions/actors/peers counts and active policies.
- Role-aware policy gates:
  - Sessions persist a handle + role (citizen/moderator/delegate) and banned flag via schema v3 migration.
  - Policy gates evaluate post/petition/vote/moderation per role; surfaced in UI and `/health`.
- Admin and first-install UI:
  - `GET/POST /admin` lets operators set Circle name/policy toggles, require verification, and add peers; settings persist to `src/data/settings.json` and feed policy evaluation.
- Static assets and templates live in `src/public`:
  - `app.css`, `app.js`
  - HTML templates under `src/public/templates` (layout + pages, including the discussion view)
- Persistence now flows through a JSON-backed store with schema migrations (`src/state/migrations.js`, meta saved to `src/data/meta.json`) to keep ledger/sessions/peers/discussions/actors ready for future DB adapters.
- Circle policy cues surface in `/health`, home, and discussion views; ledger export returns a signed envelope when `CIRCLE_PRIVATE_KEY` is provided for gossip signing.
- Auth UX highlights the hash-only guarantee and supports resuming a pending session via `?session={id}` without issuing a new blinded hash.

## Next steps

- Swap the scaffolded verifier with a real OIDC4VP implementation (e.g., `@sphereon/oid4vc` or `@credo-ts/openid4vc`) and validate presentations cryptographically.
- Expand ActivityPub: implement outbox/inbox behaviors, signed deliveries, and gossip replication of ledger + actors.
- Enrich the discussion module into the petition → debate → vote workflow and layer in Circle policy toggles (strict vs. open).
