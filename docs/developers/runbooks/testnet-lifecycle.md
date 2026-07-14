# Testnet lifecycle record — Robinhood Chain testnet (chain 46630)

Referenced by `docs/developers/runbooks/testnet.md` section 7 (T-4/T-5 lifecycle exercise → gates G-7/G-8). This is
the **durable, tx-hash-level record** of the on-chain activity exercised on the live testnet, so the
verification survives the ephemeral indexer DB (which re-backfills from the deploy block on every
stack rebuild).

- **Chain:** Robinhood Chain **testnet, chain id 46630** (official; `chaincheck` one-shot asserts it
  against the live RPC).
- **RPC:** `https://rpc.testnet.chain.robinhood.com` (public, rate-limited; **non-archive** — see the
  caveat at the bottom).
- **Explorer:** `https://explorer.testnet.chain.robinhood.com` — every hash below is checkable there.
- **Deployment (registry `packages/shared/src/addresses.ts`, key `46630`):** CurveFactory
  `0x6eb955d889b6958620FBE9DC17Fb84C7d3F08414`, treasury Safe
  `0x4ae5b5Ae7D2edd7A2d43054246D6aaAcAAFC1000`.
- **Evidence method:** all hashes/amounts below were read **directly from the chain** via
  `cast logs` (`eth_getLogs` — pruning-immune, independent of the indexer), decoding the canonical
  `@robbed/shared` `TokenCreated`/`Trade` events. Nothing here is transcribed from a mutable off-chain
  store (section 2 — no fabricated data; source is the chain itself, verified 2026-07-12).

---

## 1. Token creation — XROB

| Field | Value |
|---|---|
| Token | `0x62db5db23589f68acddb3f4c5bcdc9b9c291aaba` (ticker **XROB**) |
| BondingCurve | `0x91b0b2d63eff0fb55caa740012e0d39494a2d1c1` |
| Creator | `0x483382242c9cd1791b3fa87938412c1c96fda620` |
| **Creation tx** | **`0x6d01bd5c1cb94ebaad693b6183f46310d4b833e905f4e175551db7c80523f757`** |
| Block | 89683169 |
| metadataHash (on-chain commitment) | `0x0c323deca072784ea53847660a63328c528ebfc37a064e96ef7b03b83cfdf3ad` |
| Metadata verification | **`match`** — verifier canonicalized the R2 JSON, `keccak256` == the on-chain hash byte-for-byte (section 8.3) |

The creation tx also carries the creator's **initial buy** (see Trade #1 below — same tx hash).

---

## 2. Trades — 6 curve trades, fee is exactly 1% on every one

Read from the `Trade` events emitted by the BondingCurve `0x91b0b2d6…`. `ethAmount` is **gross**;
`fee` is the in-contract 1% accrual (net = gross − fee). `feeBps = fee × 10000 / ethAmount`.

| # | Side | tx hash | Block | ethAmount (ETH) | fee (ETH) | feeBps |
|---|---|---|---|---|---|---|
| 1 | BUY | `0x6d01bd5c1cb94ebaad693b6183f46310d4b833e905f4e175551db7c80523f757` (= creation tx) | 89683169 | 0.005000 | 0.00005000 | **100** |
| 2 | BUY | `0x0d1870ebad8f6ce7ff805e30c3348e874ebc8114c8df33c6cb760865ce62aae8` | 89683331 | 0.001000 | 0.00001000 | **100** |
| 3 | BUY | `0x11edbfa50b1ef21085df19fd9f4c8b5c53b97ba0cc2bd03c898652cc47052bf0` | 89683482 | 0.001000 | 0.00001000 | **100** |
| 4 | BUY | `0xf6e1dc32d8ff0d7b1d516953c373124ea98bc3834e712bd17d63e9adef13413c` | 89683509 | 0.001000 | 0.00001000 | **100** |
| 5 | BUY | `0x8200bbe7eaa5dda6d5da34085ac0d67e5958e6f7d9dc09f8d4323f4b79383d31` | 89683534 | 0.000100 | 0.00000100 | **100** |
| 6 | SELL | `0xf69bcedd819a67718b4247cb1d0889a05921e92b9caf82ade84996a1a771ecbb` | 89683639 | 0.002670 | 0.00002670 | **100** |

**Fee invariant confirmed on the live chain:** every trade — buys AND the sell — charges exactly
**100 bps = 1%** (D-25 / CLAUDE.md). Total fee accrued over the six trades ≈ **0.0001077 ETH**.

**Fee custody (D-25 / section 6.5).** Trade fees never push ETH to the treasury at trade time: the 1%
accrues **in-contract** and is withdrawn to the fixed treasury Safe
`0x4ae5b5Ae7D2edd7A2d43054246D6aaAcAAFC1000` by the permissionless, non-phase-gated `sweepFees()`, so
a hostile/reverting treasury can never freeze sells. (A `sweepFees()` sweep was not exercised in this
run — the accrued balance above sits claimable in the curve; recording the mechanism, not fabricating a
sweep tx.)

**Sells stay open (CLAUDE.md hard rule):** Trade #6 is a live **sell**, executed with no pause/flag
gating and the same 1% fee — the "sells are always open" invariant, observed on-chain.

---

## 3. GRADUATION — NOT YET EXERCISED on the live chain (faucet-limited)

**Graduation, permissionless `graduate()`, arb-back, the V3 `Swap`s, and `LPFeeVault.collect()` have
NOT been exercised on testnet 46630.** Total buy volume in this run was ≈ 0.008 ETH — far below
`GRADUATION_ETH` — because the testnet faucet caps the throwaway deployer's balance. Driving a token
past the graduation threshold needs more faucet ETH (or a scripted multi-actor top-up) than is
currently available.

This is a **known gap in the T-4/T-5 evidence**, not a defect:
- The curve/graduation path is fully covered by the Foundry gate suite (gates 1–4) and the local
  anvil-fork lifecycle (`bun run dev:seed` drives create → buys/sells → clamp → `graduate()` → V3
  swaps → `collect()` end-to-end against the fork).
- What remains for **G-7/G-8** is a *live-chain* graduation with recorded tx hashes. When faucet
  funding allows, run the scripted lifecycle against 46630 and append a "Graduation" section here with
  the `Graduated` tx, the LP-NFT tokenId, the V3 `Swap` tx hashes, and the `Collect`-to-treasury tx.

---

## Caveat — non-archive public RPC

`rpc.testnet.chain.robinhood.com` **prunes historical state** (~40 min): `eth_call` at an old block
returns `missing trie node`. This does **not** affect the record above — `eth_getLogs`/receipts are
pruning-immune, so all hashes/amounts are reliably re-derivable from the chain at any time. It does
affect the *indexer's* historical backfill (state reads at the event block) on the staging stacks; the
verifier's curve-immutables read has a `latest`-fallback (immutables are block-invariant), and a real
**archive** endpoint (Alchemy) removes the limitation for a durable staging backfill.
