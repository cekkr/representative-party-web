# Representative Party Framework

Prototype implementation of the Representative Party "Party Circle" kernel. The first milestone is an SSR + Vanilla Node.js server that models the OIDC4VP verifier flow and an in-memory uniqueness ledger.

## Quick start

```bash
npm install # no external deps today, keeps package-lock current
npm start
```

The server defaults to `http://0.0.0.0:3000`.

## What exists

- SSR HTML shell with a small vanilla router interceptor (no SPA), delivering partial responses when requested with `X-Requested-With: partial`.
- Mock OIDC4VP verifier endpoints:
  - `GET /auth/eudi` issues a credential offer deep link and stores a pending session (salted).
  - `GET /auth/callback?session={id}&pidHash=...` or `&pid=...` finalizes verification and records a blinded PID hash.
- In-memory "Uniqueness Ledger" to prevent duplicate citizens; health data available at `GET /health`.
- Static assets and templates live in `src/public`:
  - `app.css`, `app.js`
  - HTML templates under `src/public/templates` (layout + pages)

## Next steps

- Swap the mock verifier with a real OIDC4VP implementation (e.g., @sphereon/oid4vc or @credo-ts/openid4vc).
- Emit ActivityPub actors per verified hash and sketch the gossip protocol for ledger sync.
- Add QR generation for desktop wallet handoff and persistence beyond memory.
