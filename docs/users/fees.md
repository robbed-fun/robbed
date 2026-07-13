# Fees

**Audience:** anyone who wants to know exactly what ROBBED_ charges, who receives it, and what creators earn.
**Source of truth:** [../spec.md](../spec.md) (§6.4, §7, §12.25). This page is a derived view; when they disagree, the spec wins.

## Every fee in the system

| Fee | Amount | Paid by | Goes to |
|---|---|---|---|
| Trade fee | **1%** of the ETH side, on **both** buys and sells (hard-capped at 2% in code) | trader | accrues in the curve contract; swept to the treasury Safe by anyone via `sweepFees()` (§6.4, §12.25) |
| Creation fee | flat “~$1–2 equivalent”; currently **0.000825 ETH** (§6.4, §12.62) | creator | treasury Safe |
| Graduation fee | flat, cost-based (migration gas + thin margin), **not** a percentage of the raise; currently **0.000122 ETH** (§6.4, §12.26, §12.62) | deducted from the raised ETH at graduation | treasury Safe |
| Graduation caller reward | currently **0.002751 ETH** (~$5 equivalent at the snapshot; §12.34, §12.62) | protocol (from the curve's balance) | **whoever calls `graduate()`** — that could be you |
| Post-graduation pool fee | Uniswap v3 **1% fee tier** (§12.28) | traders on Uniswap | the LP position; claimable by the treasury through the fee vault (§6.3) |
| Creator fee | **0 in v1** (§7) | — | — (see below) |

There are no other fees: no listing fee, no graduation percentage cut, no withdrawal fee, no fee on transfers.

### Where these numbers come from

Percentages and caps are fixed in the contracts. The flat ETH amounts above are the M0 economics values locked on **2026-07-12 at ETH/USD $1,817.62 (CoinGecko)** per §12.62. ETH-pegged values are deploy-time snapshots — they are re-derived and re-locked before mainnet deploy, and no USD figure is ever stored on-chain (§2, §6.4).

## How the trade fee moves — and why you can always sell

The 1% trade fee is **never sent anywhere during your trade**. It accrues inside the curve contract, and a separate function — `sweepFees()`, callable by anyone at any time, in any phase — pushes the accumulated total to the treasury Safe (§12.25).

This is a load-bearing design choice, not an accounting detail: because no buy or sell ever transfers ETH to the treasury, a broken or hostile treasury can at worst make `sweepFees()` revert (and it can simply be retried later). It can never make a sell revert. Exits do not depend on the fee recipient behaving.

The treasury itself is a Gnosis Safe — a standard, audited multisig, never a bespoke contract (§6.6).

## What happens to liquidity fees after graduation

At graduation the raised ETH and the reserved token tranche become a full-range Uniswap v3 position in the token's 1%-tier pool. The position NFT is held by `LPFeeVault`, a ~50-line contract with no owner and no withdraw function; its only external function is `collect()`, which sends accrued trading fees to the fixed treasury address (§6.3).

The canonical description — the only one used anywhere in the product: **LP principal permanently locked; trading fees claimable by treasury** (§12.14). Nobody, including the protocol, can ever pull the principal back out.

## Creator fees: 0 today, designed for Phase 2

Honest status, because launchpads are often vague about this:

- **Today (v1), creators earn no share of trading fees.** The fee configuration has a `creatorFeeBps` field, but it is hardcoded to 0 and *no code path reads it* — there is nothing to toggle, and no admin can quietly turn it on (§7, §12.3).
- **The plumbing for Phase 2 is real, not aspirational.** Every token's creator is recorded on-chain and in the indexer schema from day 1, so historical tokens can be attributed correctly when creator earnings ship.
- **Phase 2 means new contracts, not a switch.** Because contracts are immutable, enabling creator fees requires a new Router and a pull-payment `CreatorVault` (§7) — it will apply to tokens launched under the new version, announced as such.

For context, this places ROBBED_ v1 at the conservative end of the field: pump.fun pays creators a tiered share of trading volume, Raydium LaunchLab gives graduated creators 10% of LP fees, and Clanker-style deployments split pool fees with creators. ROBBED_ v1 routes everything to the treasury and says so; Phase 2 revisits the split.

## Fee questions, quickly

- **Do I pay the trade fee on sells too?** Yes — 1% of the ETH you receive, symmetric with buys (§6.4).
- **Can fees be raised on my token later?** The trade fee is capped at 2% in code; fee parameters for a launched curve are immutable (§4.1, §6.4).
- **Who pays for graduation?** A flat cost-based fee comes out of the raise, and the caller reward incentivizes anyone to trigger it — both are protocol constants, not percentages (§12.26, §12.34).
- **Does the team earn from LP after graduation?** The treasury claims the Uniswap position's trading fees via the vault; the principal is untouchable (§6.3, §12.14).
