# apps/web/e2e — Playwright user-flow suite (owner: robbed-e2e)

Real-tx/real-signature browser tests against an **anvil fork of Robinhood Chain (4663)** using the wagmi `mock` connector wired to unlocked dev accounts — NO wallet-extension automation. Every flow asserts exactly its declared truth layers: on-chain receipt/state → indexed via the API → reconciled UI.

- Catalog: `user-flows.md` (stable flow IDs) + `user-flows-waivers.md` — both **machine-consumed** by `scripts/e2e-coverage.ts`; every catalog ID has a 1:1 `@flow`-tagged spec in `flows/<id>.spec.ts`.
- Coverage gate: `bun run e2e:coverage` must stay 100%.
- The suite points at a RUNNING stack and never spawns it: `bun run dev:d` first. Harness helpers (stack probe, anvil time-warp, seeding, wallet-bridge control, layer-assert markers, selectors) live in `harness/`.
- Full tour: `README.md` here. Production app changes belong to robbed-frontend/robbed-indexer/robbed-contracts — never patch app code from this suite.
