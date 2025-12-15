This file captures the essential implementation directives. Keep it in sync with README.md and ROADMAP.md. The core philosophy lives in principle-docs/RepresentativeParties.md (One Citizen = One Voice, soft-power accountability, liquid delegation, phygital inclusion).

## Concept anchors
- Privacy-first identity: store only blinded hashes from EUDI/OIDC4VP flows; never retain raw PID.
- Circle policy: verification is required by default; enforcement can be toggled per Circle but must be observable.
- Federation resilience: peers exchange ledger hashes and audit each other to quarantine toxic providers.

## Code map (Phase 1 kernel)
- **Entry & server**: `src/index.js` (bootstrap), `src/server/bootstrap.js` (HTTP), `src/server/router.js` (routes).
- **Route handlers**: `src/routes/` (`home`, `health`, `auth`, `discussion`, `circle`, `activitypub`, `static`).
- **Services**: `src/services/` (`auth` for credential offers/blinded hash + cookie, `activitypub` actor factory, `citizen` session lookup).
- **State/persistence**: `src/state/storage.js` (load/persist ledger, sessions, peers, discussions, actors; JSON store with migration-ready interface).
- **Views/helpers**: `src/views/templates.js` (SSR + partials), `src/views/discussionView.js` (render posts), `src/utils/` (http helpers, request parsing, text sanitization/escaping).
- **Assets**: `src/public/` (templates, CSS, JS). Static served from `/public/*`.

## UX contract (Phase 1)
- SSR-first with partial HTML responses when `X-Requested-With: partial` is set by the vanilla router.
- Auth flow must always surface: QR + deep link, hash-only guarantee, and session recovery/error states.
- Layout must show Circle policy flag, verified handle when present, and ledger/actor/discussion counts for accountability cues.
- Discussion sandbox: identity-aware posting, no CAPTCHA; copy explains accountability via blinded PID hash.

## Endpoints
- `/` landing, `/health` metrics, `/auth/eudi` start, `/auth/callback` verifier return, `/discussion` (GET/POST), `/circle/gossip`, `/circle/ledger`, `/circle/peers`, `/ap/actors/{hash}`, `/ap/inbox`, `/public/*`.

## Near-term implementation focus
- Replace verifier scaffold with real OIDC4VP validation and key management; keep QR/deep-link UX.
- Harden persistence via a pluggable store abstraction (JSON now, DB later) and add basic migrations.
- Schedule federation: signed inbox/outbox, gossip of uniqueness ledger, and peer compliance audits.
- Extend modules toward petitions → discussion → vote, keeping delegation and accountability visible in the UI (see ROADMAP.md).
