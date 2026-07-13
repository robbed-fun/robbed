# Fees

**Audience:** anyone who wants to know exactly what ROBBED_ charges, who receives it, when, and how much creators earn.
**Source of truth:** [../spec.md](../spec.md) (§6.4, §7, §12.25, §12.63). This page is a derived view; when they disagree, the spec wins.

## Every fee in the system

| Fee | Amount | Paid by | Goes to — and when |
|---|---|---|---|
| Trade fee (treasury) | **1%** of the ETH side, on **both** buys and sells | trader, on every curve trade | accrues in the curve; swept to the treasury Safe by anyone via `sweepFees()` (§6.4, §12.25) |
| **Creator fee** | **0.5%** of the ETH side, on **both** buys and sells (testnet; additive with the trade fee, total hard-capped at **2%** in code) | trader, on every curve trade | accrues in the curve; swept to the **`CreatorVault`** via `sweepCreatorFees()`, then claimed by **the token's creator** (§7, §12.63) |
| Creation fee | flat **0.000847 ETH** (§6.4, §12.62) | creator, once, at launch | treasury Safe |
| Graduation fee | flat, cost-based (migration gas + thin margin), **not** a % of the raise; **0.00045 ETH** (§6.4, §12.26, §12.62) | deducted from the raised ETH at graduation | treasury Safe |
| Graduation caller reward | flat **0.002822 ETH** (§12.34, §12.62) | protocol (from the curve's balance) | **whoever calls `graduate()`** — that could be you |
| Post-graduation pool fee | Uniswap v3 **1% fee tier** (§12.28) | traders on Uniswap, after graduation | the LP position; claimable by the **treasury** through the fee vault (§6.3) |

**Total on a curve trade (testnet): 1.5%** — 1% to the treasury + 0.5% to the creator, both on the ETH side of every buy and sell. The two are separate, independently-floored legs and their sum can never exceed the **2%** ceiling written into the contract (§6.4, §12.63).

There are no other fees: no listing fee, no graduation percentage cut, no withdrawal fee, no fee on transfers.

### Where these numbers come from

Percentages and caps are fixed in the contracts. The flat ETH amounts and the 0.5% creator rate above are the **current live testnet deploy** (chain 46630, redeployed with creator fees 2026-07-13) — read directly from the factory on-chain, not hardcoded here. ETH-pegged values are deploy-time snapshots: they are **re-derived and re-locked before mainnet**, and no USD figure is ever stored on-chain (§2, §6.4, §12.62). On **mainnet the creator rate is a deliberate deploy-time decision** — the spec's v1 default is 0, so it may launch at 0 or at a re-locked non-zero value (§7, §12.63).

## How creators earn — who, when, and how much

Creator earnings are **live**, not a promise. The plumbing shipped as part of the final-version fold (§12.63): a per-creator pull-payment escrow, `CreatorVault`.

- **How much.** A creator earns the **creator-fee leg of every curve trade on their token** — currently **0.5%** of the ETH side, symmetric on buys *and* sells (the same rate a buyer or seller pays). It is *additive* to the 1% treasury fee, and the contract guarantees `treasuryFee + creatorFee ≤ 2%`.
- **When they earn it.** On **every buy and every sell while the token is on the bonding curve** — i.e. before graduation. Each trade credits the creator's escrow; there is nothing the creator has to do to accrue it.
- **When they get paid.** Anytime. The fee first accrues inside the curve (it is *never* pushed to the creator during a trade — see below), a permissionless `sweepCreatorFees()` moves it into the `CreatorVault`, and then **`claim()` pays the creator**. Anyone can trigger the sweep and the claim, but the ETH can **only ever go to the creator address that earned it** — no one can redirect it.
- **After graduation, the creator stops earning.** Once a token graduates, trading moves to its Uniswap v3 pool, and that pool's **1% fees go to the treasury** (via the fee vault, below), not to the creator. The creator's earning window is the curve phase.

**Why creator fees can never freeze your sell.** Exactly like the treasury fee, the creator leg accrues *in the curve* and no buy or sell ever calls the creator or the vault. A broken or hostile creator address can at worst make its own `claim()` revert (retriable once fixed) — it can never make a trade revert (§6.5, §12.25, §12.63). Exits never depend on a fee recipient behaving.

### How ROBBED_ compares

pump.fun pays creators a tiered share of trading volume; Raydium LaunchLab gives graduated creators 10% of LP fees; Clanker-style deployments split pool fees with creators. ROBBED_ pays creators a straight share of **curve** trading fees (0.5% on testnet), with the mainnet rate re-locked against real economics before launch.

## How the trade fee moves — and why you can always sell

The 1% treasury fee (and the creator leg) are **never sent anywhere during your trade**. They accrue inside the curve contract, and separate functions — `sweepFees()` → treasury and `sweepCreatorFees()` → `CreatorVault`, callable by anyone at any time, in any phase — push the accumulated totals out (§12.25, §12.63).

This is a load-bearing design choice, not an accounting detail: because no buy or sell ever transfers ETH to the treasury or the creator, a broken or hostile recipient can at worst make a *sweep* revert (and it can simply be retried later). It can never make a sell revert. Exits do not depend on any fee recipient behaving.

The treasury itself is a Gnosis Safe — a standard, audited multisig, never a bespoke contract (§6.6).

## What happens to liquidity fees after graduation

At graduation the raised ETH and the reserved token tranche become a full-range Uniswap v3 position in the token's 1%-tier pool. The position NFT is held by `LPFeeVault`, a ~50-line contract with no owner and no withdraw function; its only external function is `collect()`, which sends accrued trading fees to the fixed treasury address (§6.3).

The canonical description — the only one used anywhere in the product: **LP principal permanently locked; trading fees claimable by treasury** (§12.14). Nobody, including the protocol, can ever pull the principal back out.

## Fee questions, quickly

- **How much does a creator make?** 0.5% of the ETH side of every buy and sell on their token while it's on the curve (testnet rate). On a token that trades 10 ETH of volume before graduating, that's ~0.05 ETH accrued to the creator (§7, §12.63).
- **How does a creator get paid?** Their share accrues automatically; anyone can call `sweepCreatorFees()` then `CreatorVault.claim()`, and the ETH goes only to the creator address. In the app this is a one-click "claim" (§12.63).
- **Do creators earn after graduation?** No — post-graduation, the Uniswap pool's 1% fees go to the treasury, not the creator (§6.3, §12.14).
- **Do I pay the trade fee on sells too?** Yes — 1% treasury + 0.5% creator of the ETH you receive, symmetric with buys (§6.4).
- **Can fees be raised on my token later?** The total trade fee is capped at 2% in code, and fee parameters for a launched curve are **immutable** — an owner retune can never touch a live curve (§4.1, §6.4).
- **Who pays for graduation?** A flat cost-based fee comes out of the raise, and the caller reward incentivizes anyone to trigger it — both are protocol constants, not percentages (§12.26, §12.34).
- **Does the team earn from LP after graduation?** The treasury claims the Uniswap position's trading fees via the vault; the principal is untouchable (§6.3, §12.14).
