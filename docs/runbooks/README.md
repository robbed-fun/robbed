# Runbooks — Operational Procedures

Step-by-step operational how-to, derived from the spec and the `docs/how-it-works/` designs (a runbook never overrides them): [`docker.md`](docker.md) (local stack), [`testnet.md`](testnet.md) (testnet lifecycle), [`deploy.md`](deploy.md) (deploy procedure + handoff register), [`deploy-komodo-cloudflare.md`](deploy-komodo-cloudflare.md) (hosting), [`prod-images.md`](prod-images.md) (production images + monitoring), [`environments.md`](environments.md) (LOCAL/TESTNET/MAINNET matrix), [`toolchain.md`](toolchain.md) (Foundry/solc/static-analysis toolchain).

One machine-consumed file lives here: [`env-inventory.md`](env-inventory.md) — the authoritative per-variable env table, parsed by `scripts/env-sync-check.ts` (both directions against every `.env.example`). **Its path is frozen**; see the machine-consumer map in [`../README.md`](../README.md).
