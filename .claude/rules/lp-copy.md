---
paths:
  - "apps/web/**"
  - "packages/shared/**"
  - "docs/**"
  - "README.md"
---

# User-facing copy — canonical language

- LP copy is one exact sentence: **"LP principal permanently locked; trading fees claimable by treasury."** Never "burned" in LP context — unless the documented V2 fallback is formally adopted, which flips the copy (recorded in the design decisions log, `docs/developers/design-decisions.md`). Enforced by `check-hard-rules.sh` (web/shared) and doc-check gate c (docs).
- Never describe the product as an order book — it is an AMM with soft confirmations (see `README.md`).
- Confirmation tiers appear everywhere in UX copy with these exact names: **soft-confirmed → posted-to-L1 → finalized** (`docs/developers/architecture.md`).
