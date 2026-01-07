# Provider-Blind Mode (Optional)

## Summary
Provider-blind mode reduces provider attribution for user identities and envelope traffic within a Circle. User IDs remain Circle-unique and independent of provider. The goal is to minimize which provider a user belongs to in gossip and UI, without losing auditability or abuse controls.

## Goals
- Hide provider attribution from peers and observers where feasible.
- Preserve one-person-one-voice and policy gate enforcement.
- Keep auditability, quarantine, and abuse response possible.
- Avoid leaking provider identity in envelope metadata and UI by default.

## Non-goals
- Hiding activity from the user's own provider (local delivery still requires it).
- Full network anonymity against a global passive adversary.
- Immediate replacement of ActivityPub addressing (can be layered later).

## Threat model
- Adversaries: other providers in the Circle, network observers, or a malicious provider.
- Attacks:
  - Provider inference from issuer fields, actor handles, or HTTP endpoints.
  - Correlation via timing, envelope ordering, or gossip paths.
  - Metadata leakage via media URLs, profile fields, or activity feeds.
- Required defenses:
  - Envelopes must prove Circle membership without naming the provider.
  - Auditors must be able to reveal issuer on abuse or policy disputes.

## Protocol candidates (short list)
1) Group signatures with traceability
   - Providers share a group public key. Envelopes are signed with a group
     signature that proves "signed by a Circle member" without issuer.
   - A quorum of auditors can open the signature to identify the issuer.
   - Pros: strong issuer privacy with accountability.
   - Cons: heavy key management and new crypto dependencies.

2) Ring signatures + sealed issuer escrow
   - Envelopes include a ring signature over the provider key set.
   - An encrypted issuer field is sealed to an audit quorum (t-of-n).
   - Pros: simpler than full group signatures, keeps reveal path.
   - Cons: ring size growth and signature size overhead.

3) Mixnet or onion routing for gossip transport
   - Gossip traffic is routed through relays that strip origin metadata.
   - Combine with (1) or (2) so envelopes lack clear issuer fields.
   - Pros: hides network-level origin; incremental deployment possible.
   - Cons: latency, relay trust, and availability tradeoffs.

4) Anonymous credential proofs (BBS+/Idemix)
   - Providers issue Circle membership credentials; users prove membership
     without revealing issuer or identity.
   - Can be used for session proofs and signed actions.
   - Pros: strong unlinkability.
   - Cons: high complexity, wallet and verifier support required.

## Selected candidates for deeper design
1) Ring signatures + sealed issuer escrow
   - Keep issuer privacy for peers while preserving a controlled reveal path.
   - Fits existing envelope model with minimal changes to identity flows.
   - Scales to small-to-medium Circle sizes with acceptable signature size.

2) Mixnet or onion routing for gossip transport
   - Complements ring signatures by hiding network-level origin metadata.
   - Can be introduced incrementally as a transport layer option.

## Envelope requirements (draft)
- Remove or encrypt issuer fields by default in provider-blind mode.
- Keep policy id/version and module fields (vote: petitionId/authorHash/choice,
  transactions: summary/entries).
- Store sealed issuer data for audit, encrypted to an audit quorum.
- Preserve validation status (preview/validated) as usual.
- Prefer ringId references over full ring key lists in envelopes.

## Envelope alignment with current schemas (draft)
### Vote envelopes (current fields)
```json
{
  "issuer": "https://provider.example",
  "policy": { "id": "party-circle", "version": 1 },
  "petitionId": "petition-123",
  "authorHash": "blinded-hash",
  "choice": "yes",
  "createdAt": "2025-09-10T12:00:00Z",
  "status": "validated",
  "signature": "base64..."
}
```

### Vote envelopes (provider-blind)
- issuer omitted or null.
- signature replaced by ringSignature + issuerEscrow.
```json
{
  "policy": { "id": "party-circle", "version": 1 },
  "petitionId": "petition-123",
  "authorHash": "blinded-hash",
  "choice": "yes",
  "createdAt": "2025-09-10T12:00:00Z",
  "status": "validated",
  "ringId": "circle-2025-09",
  "ringSignature": "base64...",
  "issuerEscrow": {
    "threshold": 3,
    "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"],
    "sealedIssuer": "base64..."
  }
}
```

### Transaction summary envelopes (current fields)
```json
{
  "id": "transactions-1725979200000",
  "issuer": "https://provider.example",
  "issuedAt": "2025-09-10T12:00:00Z",
  "profile": { "mode": "hybrid", "adapter": "json" },
  "policy": { "id": "party-circle", "version": 1 },
  "status": "validated",
  "summary": "sha256:...",
  "entries": [
    {
      "id": "uuid",
      "type": "petition-sign",
      "petitionId": "petition-123",
      "actorHash": "blinded-hash",
      "digest": "sha256:...",
      "createdAt": "2025-09-10T11:59:00Z"
    }
  ],
  "signature": "base64..."
}
```

### Transaction summary envelopes (provider-blind)
- issuer omitted or null.
- signature replaced by ringSignature + issuerEscrow.
```json
{
  "id": "transactions-1725979200000",
  "issuedAt": "2025-09-10T12:00:00Z",
  "profile": { "mode": "hybrid", "adapter": "json" },
  "policy": { "id": "party-circle", "version": 1 },
  "status": "validated",
  "summary": "sha256:...",
  "entries": [
    {
      "id": "uuid",
      "type": "petition-sign",
      "petitionId": "petition-123",
      "actorHash": "blinded-hash",
      "digest": "sha256:...",
      "createdAt": "2025-09-10T11:59:00Z"
    }
  ],
  "ringId": "circle-2025-09",
  "ringSignature": "base64...",
  "issuerEscrow": {
    "threshold": 3,
    "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"],
    "sealedIssuer": "base64..."
  }
}
```

Field notes:
- ringId references a stable, ordered list of provider public keys for an epoch.
- ringSignature signs the canonicalized envelope payload (exclude issuerEscrow).
- issuerEscrow seals the real issuer key id for audit quorum recovery.
- Canonicalization should use a stable JSON scheme (JCS or equivalent).

Size expectations (rough):
- Ring signature size grows linearly with ring size (O(n)).
- For ring sizes 8-32, plan on 1-5 KB for the signature payload.
- Escrow payload is typically sub-1 KB, depending on quorum scheme.

## Verification flow (draft)
1) Validate policy id/version and module gate (as today).
2) Resolve ringId to ring public keys (from Circle ring registry).
3) Verify ringSignature over the canonical envelope payload.
4) Validate module-specific fields (petitionId/authorHash, summary/entries).
5) Persist envelope with issuerEscrow; mark preview/validated as configured.
6) On audit request: quorum decrypts issuerEscrow, logs reveal to transactions.

## Gossip endpoint mapping (draft)
- POST /circle/gossip: advertise ringId epochs, ring public keys, and audit
  committee key ids; optional relay or mixnet config hints.
- GET /votes/ledger and POST /votes/gossip: emit/ingest provider-blind
  vote envelopes with ringSignature and issuerEscrow.
- GET /transactions/ledger and POST /transactions/gossip: emit/ingest
  provider-blind transaction summaries with ringSignature and issuerEscrow.
- GET /circle/ledger remains hash-only; issuer metadata stays sealed.
- Backward compatibility: when provider-blind is off, accept issuer fields;
  when on, reject or ignore issuer fields and require ringSignature.

## Endpoint JSON shapes (draft)
### GET /votes/ledger
```json
{
  "entries": [
    {
      "policy": { "id": "party-circle", "version": 1 },
      "petitionId": "petition-123",
      "authorHash": "blinded-hash",
      "choice": "yes",
      "createdAt": "2025-09-10T12:00:00Z",
      "status": "validated",
      "ringId": "circle-2025-09",
      "ringSignature": "base64...",
      "issuerEscrow": { "threshold": 3, "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"], "sealedIssuer": "base64..." }
    }
  ],
  "status": "validated",
  "replication": { "mode": "hybrid", "adapter": "json" }
}
```

### POST /votes/gossip
```json
{
  "entries": [ { "policy": { "id": "party-circle", "version": 1 }, "petitionId": "petition-123", "authorHash": "blinded-hash", "choice": "yes", "createdAt": "2025-09-10T12:00:00Z", "status": "validated", "ringId": "circle-2025-09", "ringSignature": "base64...", "issuerEscrow": { "threshold": 3, "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"], "sealedIssuer": "base64..." } } ],
  "status": "validated",
  "peer": "https://peer.example"
}
```

### GET /transactions/ledger
```json
{
  "envelope": {
    "id": "transactions-1725979200000",
    "issuedAt": "2025-09-10T12:00:00Z",
    "profile": { "mode": "hybrid", "adapter": "json" },
    "policy": { "id": "party-circle", "version": 1 },
    "status": "validated",
    "summary": "sha256:...",
    "entries": [ { "id": "uuid", "type": "petition-sign", "petitionId": "petition-123", "actorHash": "blinded-hash", "digest": "sha256:...", "createdAt": "2025-09-10T11:59:00Z" } ],
    "ringId": "circle-2025-09",
    "ringSignature": "base64...",
    "issuerEscrow": { "threshold": 3, "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"], "sealedIssuer": "base64..." }
  },
  "replication": { "mode": "hybrid", "adapter": "json" }
}
```

### POST /transactions/gossip
```json
{
  "envelope": { "id": "transactions-1725979200000", "issuedAt": "2025-09-10T12:00:00Z", "profile": { "mode": "hybrid", "adapter": "json" }, "policy": { "id": "party-circle", "version": 1 }, "status": "validated", "summary": "sha256:...", "entries": [ { "id": "uuid", "type": "petition-sign", "petitionId": "petition-123", "actorHash": "blinded-hash", "digest": "sha256:...", "createdAt": "2025-09-10T11:59:00Z" } ], "ringId": "circle-2025-09", "ringSignature": "base64...", "issuerEscrow": { "threshold": 3, "committeeKeyIds": ["key-a", "key-b", "key-c", "key-d", "key-e"], "sealedIssuer": "base64..." } },
  "status": "validated",
  "peer": "https://peer.example"
}
```

## /admin audit-committee policy section (draft)
Fields:
- providerBlind.mode: off | observe | strict.
- providerBlind.ring.currentId: string, required when mode != off.
- providerBlind.ring.epochSeconds: integer (min 86400, max 31536000).
- providerBlind.ring.keys: ordered list of provider key ids (min 3, unique).
- providerBlind.ring.maxSize: integer (cap for ring size, min 3).
- providerBlind.audit.threshold: integer t, 2 <= t <= n.
- providerBlind.audit.members: list of { keyId, role, termStart, termEnd }.
- providerBlind.audit.overrideComposition: boolean (default false).
- providerBlind.audit.requireReason: boolean (default true).
- providerBlind.audit.maxScopeDays: integer (default 30).
- providerBlind.audit.emergencyOverride: boolean (default false).
- providerBlind.transport.mixnetEnabled: boolean.
- providerBlind.transport.relays: list of URLs (when mixnetEnabled).
- providerBlind.transport.maxHops: integer (min 1, max 5).
- providerBlind.transport.timeoutMs: integer (min 1000, max 30000).

Validation rules:
- If mode is strict, ring.currentId, ring.keys, and audit.members are required.
- ring.keys size must be <= ring.maxSize and >= 3.
- audit.members key ids must be unique and present in the Circle key registry.
- audit.threshold must be <= audit.members.length and >= 2.
- audit.roles must include at least 2 member seats, 2 provider seats, and
  1 observer seat unless Circle policy explicitly overrides the composition.
- termEnd must be after termStart; expired members cannot satisfy quorum.

Transaction logging rules:
- policy.provider_blind.update on any mode/ring/transport change.
- policy.audit_committee.update on committee membership or threshold change.
- audit.issuer_reveal.request on every reveal request (include scope + reason).
- audit.issuer_reveal.approve or audit.issuer_reveal.reject with signer ids.
- audit.issuer_reveal.execute when issuerEscrow is opened (include issuer key id
  and envelope ids or hashed envelope ids).

## Audit quorum and governance
- Quorum model: t-of-n audit committee keys (default 3-of-5).
- Committee composition:
  - 2 seats: elected by Circle members (person sessions when enforced).
  - 2 seats: provider operators within the Circle.
  - 1 seat: independent observer or rotating civic auditor.
- Governance path:
  - Committee membership and threshold are set in Circle policy and exposed in /admin.
  - Issuer reveal requires a signed request, logged to the transactions registry.
  - Reveal requests must include scope (envelope ids, time window) and reason.
  - Rejected or abused requests trigger policy review or automatic quorum reset.

## Open questions
- How to reconcile ActivityPub actor addresses (which embed provider)?
- Which modules must stay provider-attributed (media hosting, email/SMS)?
- How to balance provider-blind mode with peer health and quarantine UX?
