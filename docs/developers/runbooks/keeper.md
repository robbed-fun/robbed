# Runbook — Auto-graduation keeper (`apps/keeper`)

**Status:** v1 (2026-07-13). Ops procedures for the off-chain auto-graduation keeper — funding the wallet, reading alerts, responding to a persistent-revert (donation-brick) alert, and rotating the key. Design context: [`apps/keeper/README.md`](../../../apps/keeper/README.md) + [`architecture.md`](../architecture.md) (Keeper service). Root authority: `docs/spec.md` — §12.12 (`ReadyToGraduate` two-way lock), §12.34 (caller reward), §12.62 (gas model), §10 gate 7 (monitoring). A runbook never overrides the design docs or the spec.

## What the keeper is (one paragraph)

`BondingCurve.graduate()` is permissionless and pays a small caller reward (§12.34) sized to ≥10× its gas, so calling it is net-positive. The keeper is the **standing caller**: it watches the on-chain `GraduationReady` event over the Alchemy WS RPC and fires `graduate(curve)` within ~1–2 blocks, with a periodic Postgres sweep as the fallback. It never modifies chain, listing, or moderation state — it only calls `graduate()`. If the keeper is down, graduation is not *broken* — it is merely not automatic (anyone, including a re-started keeper's next sweep, can still graduate any `ReadyToGraduate` curve and collect the reward). Sells are never blocked by any of this (§6.5).

## Environment matrix

| Stack | Keeper | RPC | Signer | Notes |
|---|---|---|---|---|
| dev (`docker-compose.yml`) | **ON** | `ws://anvil:8545` (fork) | anvil account #4 (public dev key) | Chosen outside e2e roles 0–3 (creator/treasury/trader/trader2) to avoid nonce contention |
| testnet (`docker-compose.testnet.yml`) | **ON** | `TESTNET_RPC_WS_URL` → `TESTNET_RPC_URL` | `TESTNET_KEEPER_PRIVATE_KEY` (funded ops wallet) | Key via gitignored root `.env`; ~0.05 ETH; **NOT** the deployer |
| mainnet (`docker-compose.mainnet.yml`) | **OFF (profile-gated)** | `MAINNET_RPC_WS_URL` → `MAINNET_RPC_URL` | `MAINNET_KEEPER_PRIVATE_KEY` | `profiles: ["keeper"]`; start only **after Gate G-A** (§14) |

WS RPC enables the sub-second `eth_subscribe` detection path. An HTTP-only RPC still works — detection degrades to log polling and the `KEEPER_POLL_MS` sweep remains the safety net.

## Configuration (env)

Required (startup fails closed if missing/invalid; the process also asserts `CHAIN_ID` equals the live RPC `eth_chainId`):

| Var | Meaning |
|---|---|
| `KEEPER_RPC_URL` | chain RPC; `ws(s)://` → push detection, `http(s)://` → polling + sweep |
| `CHAIN_ID` | 4663 mainnet / 46630 testnet / the dev fork — must match the live RPC |
| `KEEPER_PRIVATE_KEY` | **SECRET** — funded ops wallet; NOT the deployer/treasury |
| `DATABASE_URL` | Postgres (read-only use) for the fallback sweep |

Optional (safe defaults): `KEEPER_POLL_MS`=15000, `KEEPER_GAS_CAP`=30000000, `KEEPER_MAX_ATTEMPTS`=3, `KEEPER_BACKOFF_BASE_MS`=500, `KEEPER_FAILED_COOLDOWN_MS`=300000, `KEEPER_BALANCE_POLL_MS`=60000, `KEEPER_BALANCE_WARN_MULTIPLE`=20, `KEEPER_TYPICAL_GRADUATE_GAS`=1500000, `KEEPER_PORT`=3003, `REDIS_URL` (**reserved** — detection is on-chain, not via Redis; see the keeper README). Full descriptions in `apps/keeper/.env.example`.

> The keeper env vars are **not yet in `env-inventory.md`** (that table is robbed-architect-owned, P-1). Flagged for the architect to add an `<!-- env-sync file=apps/keeper/.env.example -->` section; until then env-sync is green (unreferenced examples are not checked).

## Funding the wallet

The caller reward offsets gas *per graduation*, but the wallet must **front** each tx's gas before the reward lands in the same tx, and it needs a working balance across many graduations.

1. Pick a dedicated ops wallet — **never the deployer or the treasury Safe**. On testnet, generate one and record only its address here; keep the key out of the repo.
2. Fund it: **~0.05 ETH on testnet** is a comfortable starting float. On mainnet, size the float from the fork-measured graduate() gas (§12.62, ≈0.8M gas worst case) × the live gas price × a healthy multiple; top up when the low-balance alert fires.
3. Wire the key via the **gitignored root `.env`** (compose auto-loads it for `${...}` interpolation): `TESTNET_KEEPER_PRIVATE_KEY=0x…` (testnet) / `MAINNET_KEEPER_PRIVATE_KEY=0x…` (mainnet, only when running the keeper profile). Confirm `.env` is gitignored (it is — `.gitignore` `.env` / `.env.*`, with `**/.env.example` re-included).

**Balance watch.** Every `KEEPER_BALANCE_POLL_MS` the keeper computes `threshold = KEEPER_BALANCE_WARN_MULTIPLE × (KEEPER_TYPICAL_GRADUATE_GAS × gasPrice)` and, when the balance drops below it, logs `event:"keeper_wallet_low_balance"` (`level:"error"`, `alert:"top_up_required"`) and marks `/healthz` `status:"degraded"`. **Action: top up the wallet.** A low balance is an alert, not a crash — the container stays up and healthy-ish so it keeps working larger graduations it can still afford.

## Health + observability

- `GET /healthz` (host port: dev 4003, testnet 4103, mainnet 4203 → container 3003). Body: `status` (`ok` | `degraded` | `stale`), `detection` (`ws-subscription` | `http-polling`), `inFlight`, `cooldown`, `wallet` (address, balanceWei, warnThresholdWei, low), and `metrics`. HTTP 200 for `ok`/`degraded`, **503** only for `stale` (the sweep loop has not run within ~4× `KEEPER_POLL_MS` — a genuinely stuck loop). The compose healthcheck curls this.
- **Structured logs** (one JSON line per event, `service:"keeper"`). Key events: `graduated`, `already_graduated_by_other`, `graduate_attempt_failed` (warn, with `kind` + `willRetry`), `graduation_failed_persistent` (**error**), `keeper_wallet_low_balance` (**error**), `sweep_results`, `graduation_watch_error` (warn — transport drop; the sweep is the backstop while it reconnects).
- **Counters** in the `/healthz` `metrics` block: `graduatedTotal`, `alreadyGraduatedTotal`, `failedPersistentTotal`, `transientRetriesTotal`, `sweepsTotal`, `lastSweepAt`, `lastSweepScanned`. These feed the gate-7 stuck-graduation monitoring (§10 gate 7; deploy.md H.5).

## Alerts and responses

### `keeper_wallet_low_balance`
Top up the ops wallet (see Funding). No graduation is lost meanwhile — the sweep re-attempts once funded.

### `graduation_failed_persistent` — the donation-brick signature (escalate)
Meaning: `graduate()` reverted for the full retry budget while the curve's `phase()` stayed `ReadyToGraduate`. This is the §6.3/§12.33 case — the V3 pool's tick was pushed outside the migrator's arb-back tolerance (a donation/swap grief on the pre-graduation pool), so the migrator refuses to mint into a hostile ratio and reverts rather than lose value. It is **uneconomic and self-correcting** (§12.62): the attacker profits nothing, and a harmed holder can sell into the polluted band to restore the tick, after which `graduate()` succeeds.

Response:
1. **Do not hot-loop or manually spam `graduate()`** — the keeper already set a `KEEPER_FAILED_COOLDOWN_MS` cooldown on that curve; repeated reverts just burn gas.
2. Confirm on the explorer (Blockscout) that the curve is `ReadyToGraduate` and inspect the token's V3 pool `slot0` tick vs the target — a large offset confirms the grief.
3. Escalate to robbed-security / robbed-contracts per the gate-7 stuck-graduation procedure (deploy.md H.5). The sanctioned fix is a corrector swap (permissionless) that restores the tick, then graduation proceeds — the keeper's next post-cooldown sweep will pick it up automatically. A periphery **correct-and-graduate** path is a contracts-owned option (spec §12 UM-2 Part-2, disposition (a)); the keeper never edits the curve.
4. Track it: a rash of persistent alerts across many tokens is a coordinated-grief signal, not a keeper bug.

### `graduation_watch_error` (warn)
The WS subscription dropped. viem reconnects; the fallback sweep covers the gap. Only escalate if it repeats continuously **and** `sweepsTotal` stops advancing (then treat as a stuck loop / RPC outage — check the RPC provider).

## Key rotation

1. Generate a new ops wallet; fund it (Funding).
2. Update the stack's gitignored `.env` (`TESTNET_KEEPER_PRIVATE_KEY` / `MAINNET_KEEPER_PRIVATE_KEY`) with the new key.
3. Restart only the keeper: `docker compose -f docker-compose.<stack>.yml up -d --no-deps keeper` (mainnet: add `--profile keeper`). No other service depends on the keeper's identity.
4. Verify `/healthz` shows the **new** `wallet.address` and `status:"ok"`; drain/retire the old wallet's residual balance.
5. Rotate immediately if a key is ever exposed — the keeper's only power is calling permissionless `graduate()`, so blast radius is limited to wasted gas / griefed graduation attempts, never fund theft, but rotate anyway.

## Starting / stopping

- dev: starts with `docker compose up` (ON by default).
- testnet: `docker compose -f docker-compose.testnet.yml up -d keeper` (requires `TESTNET_KEEPER_PRIVATE_KEY` in `.env`).
- mainnet (post-G-A only): `docker compose -f docker-compose.mainnet.yml --profile keeper up -d keeper`. Without `--profile keeper` the service does not start (Gate G-A guard) — this is intentional.
- Stopping the keeper is always safe: it blocks nothing on-chain (graduation stays permissionless; sells stay open). A future `graduate()` just waits for the next caller.
