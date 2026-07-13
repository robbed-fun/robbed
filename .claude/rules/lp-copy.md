---
paths:
  - "apps/web/**"
  - "packages/shared/**"
  - "docs/**"
  - "README.md"
---

# User-facing copy — canonical language

- LP copy is one exact sentence: **"LP principal permanently locked; trading fees claimable by treasury."** Never "burned" in LP context — unless the V2 fallback is explicitly adopted, which flips the copy (spec §12.14). Enforced by `check-hard-rules.sh` (web/shared) and doc-check gate c (docs).
- Never describe the product as an order book — it is an AMM with soft confirmations (spec §1).
- Confirmation tiers appear everywhere in UX copy with these exact names: **soft-confirmed → posted-to-L1 → finalized** (spec §2.1).
