---
paths:
  - "**/*.md"
---

# Docs placement — two-bucket policy

- Protocol + contributor/security docs → `docs/` sanctioned set only: `README.md`, `spec.md`, `CONTRIBUTING.md`, `SECURITY.md`, `users/`, `developers/` (incl. `developers/runbooks/`). Everything else colocates as per-package READMEs. The repo root keeps only `README.md` + `CLAUDE.md`.
- **NEVER create plans/trackers/status/progress md files anywhere** (removed 2026-07-12; no flagship public DeFi repo ships them). Security reviews go in the PR that closes each gate — never committed.
- Machine-consumed paths (`docs/spec.md`, `docs/developers/runbooks/env-inventory.md`, `apps/web/e2e/user-flows.md` + waivers) cannot move without re-pointing every consumer in the same change — full map: `docs/README.md`.
- All of this is enforced by the `docs-placement` check in `scripts/doc-check.ts` — run `bun scripts/doc-check.ts` after any docs edit.
