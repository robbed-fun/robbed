# ROBBED_ e2e (Playwright) — harness + user-flow suite

Owner: **robbed-e2e** (`.claude/agents/robbed-e2e.md`). Plan rows **I-5a** (harness) + **I-5b** (all flows).

This suite runs the **50 catalog flows** in `user-flows.md` (DISC-1..4, TD-1..13 + TD-3b/TD-6b,
LAUNCH-1..3, COLLECT-1, GRAD-AUTO, PORT-1..8, ERR-1..14 with ERR-6 split a/b, **CFEE-1..4** = **50 stable IDs**)
against a **running** stack — one `@flow`-tagged spec per catalog ID, each asserting **exactly** its
declared `assertable-layers` (on-chain → indexed → UI), honouring `user-flows-waivers.md`.

**`CFEE-1..4` are DEPLOYED + running (2026-07-13).** The post-graduation creator-fee generation
(§12.67/§12.68/§12.69: new CurveFactory + BondingCurve + Router + `CreatorVault` + creator-aware
`LPFeeVault`; `creatorLpShareBps == 5000`, `CREATOR_FEE_BPS == 50`) is deployed to the fork, so the
`test.fixme`/`@pending:phase2` guards are removed and all four run green. `CFEE-1`/`CFEE-2` are widened
to **on-chain · indexed** — the split-Collect/CreatorVault roll-up is served over REST (`GET /v1/creators/
:a/claimable[/:token]`, authoritative live vault balances) and reconciled to the on-chain credit;
`CFEE-3`/`CFEE-4` stay **on-chain** invariants. The **UI leg of CFEE-1/CFEE-2 stays waived** — the
frontend `CreatorEarningsPanel` enumerates post-grad buckets from a `GET /v1/creators/:a/token-claimable`
LIST endpoint the API does not implement (it serves single-row `/claimable/:token`), so its buckets fall
back to an on-chain read that doesn't reliably surface end-to-end (reported to robbed-indexer/robbed-frontend).
**Dev-stack dependency:** the deploychain one-shot now emits `CREATOR_VAULT_ADDRESS` + `WETH_ADDRESS`
into `local.env` — without them the indexer never registers the `CreatorVault`/`FeesSplit` sources and the
CFEE-1/2 indexed leg is silent.

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
`anvil_setCode` hostile-sink manipulation (`makeTreasuryRevert` for ERR-5 §12.25; the generic
`makeAddressRevert` for CFEE-3's hostile creator) — all harness-side, never a contract edit.
`harness/creator-fee.ts` (§12.67/§12.68/§12.69) drives the post-grad path: real SwapRouter02
volume generation (both legs), the split `collect()` outcome (`FeesCollected` + `FeesSplit`), the
pre-grad `sweepCreatorFees`, and the `CreatorVault` `claim`/`claimERC20` + `creatorOf`/registration
reads. The ENTIRE surface is imported from `@robbed/shared/abi` (the §12.69 additions —
`FeesSplit`/`creatorOf`/`creatorLpShareBps`/`registerCreator`/`tokenBalanceOf`/`claimERC20` — landed
in the shared codegen 2026-07-13; the harness was authored against local stubs matching
`contracts/src/interfaces/` and swapped to the shared ABIs the moment they regenerated — no local
ABI stub remains).

## Known dependencies / gaps

- **ERR-6b** self-provisions its mismatch fixture (`seedMismatchToken`: API pin → tamper the
  stored object via `mc` inside the compose minio container → `createToken` committing the
  original hash). Needs docker access to `robbed-minio-1` (override via `E2E_MINIO_CONTAINER`);
  a remote stack can supply `E2E_MISMATCH_TOKEN` instead. Skips with a clear message when neither
  is available.
- **Upload rate limit:** the API caps `POST /v1/uploads/image` at 10/h per IP (`uploads_h`).
  A full matrix run consumes ~5 (LAUNCH-1/2, ERR-6a, TD-11, ERR-6b) — more than one full run per
  hour against the same API instance can trip 429s; restart the api container to reset (in-memory
  limiter in dev).
- **Web must be served with the SSR seam + fork addresses:** compose now runs an `apiproxy`
  sidecar (SSR's `localhost:4001` inside the web container) and the web service sources
  `tools/localstack/out/local.env` into `NEXT_PUBLIC_E2E_*` at boot — `docker compose up web`
  with `NEXT_PUBLIC_E2E=true NEXT_PUBLIC_MOCK_DATA=false NEXT_PUBLIC_E2E_ACCOUNTS=…` is all
  that's needed.
- **COLLECT-1** reads the LP position `tokenId` from the graduation receipt's `Graduated` log
  (the indexed detail does not surface `lpTokenId` — gap → robbed-indexer).
- **Chain-time rule:** the fork clock is warped ahead of the host wallclock by the suite; all
  deadlines/windows must come from `chainNow()`/`txDeadline()` (harness/anvil.ts), never
  `Date.now()`.
- Selectors are **copy/role-derived** (the app ships few `data-testid`s) and centralised in
  `harness/selectors.ts` — verify against the live DOM on first green run; drift is a one-file fix.

## Known product defects (specs intentionally red until fixed — do NOT weaken)

- **LAUNCH-2** — the launch form's initial-buy preview never renders: `useLaunchEconomics`
  reads `CurveFactory.curveParameters()`, which returns the TRANSIENT `_stagedParams` (all
  zeros outside `_deployCurve`). Catalog step "live preview shows tokens received + minTokensOut"
  is ratified → robbed-frontend (needs a real source for `virtualEth0/virtualToken0/graduationEth`;
  possibly a contracts getter → robbed-contracts).
- **TD-6** — the token page never re-engines venues live: `token.status` is a static SSR prop
  (no WS/read-driven update path), so the widget stays on the graduating interstitial after
  `graduate()` and the header pill stays stale until reload. Catalog step "all WS-driven, no
  reload" is ratified → robbed-frontend.
