# ROBBED_ e2e (Playwright) — harness + user-flow suite

Owner: **robbed-e2e** (`.claude/agents/robbed-e2e.md`). Plan rows **I-5a** (harness) + **I-5b** (all flows).

This suite runs the **44 catalog flows** in `user-flows.md` (DISC-1..4, TD-1..12 + TD-3b,
LAUNCH-1..3, COLLECT-1, ERR-1..14 with ERR-6 split a/b, PORT-1..8 = **44 stable IDs**) against a **running**
stack — one `@flow`-tagged spec per catalog ID, each asserting **exactly** its declared
`assertable-layers` (on-chain → indexed → UI), honouring `user-flows-waivers.md`.

## Layout

```
apps/web/playwright.config.ts   # points at a running stack; never spawns it
apps/web/e2e/
  harness/                      # config, stack-probe, anvil (viem test client), api reader,
                                #   wallet bridge control, layer-assert markers, selectors, seed
  flows/<id>.spec.ts            # 1:1 with catalog IDs (disc-1.spec.ts … err-14.spec.ts)
scripts/e2e-coverage.ts         # STATIC coverage gate (root `e2e:coverage`) — needs NO stack
```

## Wallet model — real txs, no extension automation

The app swaps its real RainbowKit connectors for the wagmi **`mock` connector** wired to anvil's
unlocked dev accounts **only when `NEXT_PUBLIC_E2E=true`** (`src/shared/lib/wagmi.ts`). The mock
connector delegates `eth_sendTransaction` + signing (incl. EIP-2612 typed-data for `sellWithPermit`)
to the anvil transport, so tests get **real transactions and real signatures** with zero wallet-UI
flake. Playwright drives connect/switch through the in-app bridge `window.__ROBBED_E2E__`
(`src/shared/lib/e2e-bridge.tsx`), one connector per account (0=creator, 1=treasury, 2=trader,
3=trader2). None of this ships to production (strictly `NEXT_PUBLIC_E2E`-gated).

## Running

1. **Bring up the stack** (not spawned by Playwright): `docker compose up` (I-2) brings up anvil
   fork (4663) + api + ws + indexer + web, or run them manually.
2. **Serve web in e2e mode** — `NEXT_PUBLIC_*` are build-time inlined, so the web server MUST be
   started with:
   ```
   NEXT_PUBLIC_E2E=true
   NEXT_PUBLIC_E2E_ACCOUNTS=0xf39Fd6…,0x709979…,0x3C44Cd…,0x90F79b…   # anvil accounts 0..3
   # Fork contract addresses (addresses.ts E2E override) — WITHOUT these,
   # requireAddress() throws and NO UI-driven tx can ever be sent (every
   # TD/LAUNCH flow fails with "no deployment for CHAIN_ID=4663"). Values map
   # 1:1 from tools/localstack/out/local.env (deploychain output):
   NEXT_PUBLIC_E2E_ROUTER=$ROUTER_ADDRESS
   NEXT_PUBLIC_E2E_CURVE_FACTORY=$CURVE_FACTORY_ADDRESS
   NEXT_PUBLIC_E2E_LP_FEE_VAULT=$LP_FEE_VAULT_ADDRESS
   NEXT_PUBLIC_E2E_MIGRATOR=$MIGRATOR_ADDRESS
   NEXT_PUBLIC_E2E_TREASURY=$TREASURY_ADDRESS
   ```
   (docker-compose.yml passes all of these through to the `web` service; export them
   before `docker compose up -d web` / `bun run dev:stack`.)
3. **Point the harness at the stack** via `E2E_*` env (defaults in `harness/config.ts`):
   | var | default (task ports) | docker-compose host ports |
   |---|---|---|
   | `E2E_WEB_URL` | `http://localhost:3000` | `http://localhost:4000` |
   | `E2E_API_URL` | `http://localhost:3001` | `http://localhost:4001` |
   | `E2E_WS_URL`  | `ws://localhost:3002`   | `ws://localhost:4002` |
   | `E2E_RPC_URL` | `http://localhost:8545` | `http://localhost:4545` |
4. `bun run e2e` (root) or `bunx playwright test` (in `apps/web`). Specs `test.skip()` with a clear
   message when the stack is unreachable — they never fake a pass.
5. `bun run e2e:coverage` — the **static** gate (parses files only; passes with no stack). Exits
   non-zero on any uncovered ID, under/over-asserted flow, orphan tag, or catalog/waiver drift.

## Fixtures & fork control

`harness/seed.ts` builds fixtures the product's own way (API image upload → metadata pin + shared
hash re-verify → `Router.createToken`) and drives curves to/over graduation. `harness/anvil.ts`
adds time-warp (`increaseTime`/`mine`), snapshot/revert, granular pause setters, and the
`anvil_setCode` hostile-treasury manipulation for ERR-5 (§12.25) — all harness-side, never a
contract edit.

## Known dependencies / gaps

- **ERR-6b** needs an **indexer-provided mismatch fixture** (a token whose on-chain `metadataHash`
  ≠ its post-launch-mutated stored JSON) exported as `E2E_MISMATCH_TOKEN` by `dev:seed`; the spec
  skips with a clear message until it exists (gap → robbed-indexer).
- **COLLECT-1** reads the LP position `tokenId` from the indexed token detail (`lpTokenId`); if the
  indexer doesn't surface it, that's a gap → robbed-indexer.
- Selectors are **copy/role-derived** (the app ships few `data-testid`s) and centralised in
  `harness/selectors.ts` — verify against the live DOM on first green run; drift is a one-file fix.
