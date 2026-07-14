# Fees

**Audience:** anyone who wants to know exactly what ROBBED_ charges, who receives it, when, and how much creators earn.
**Source of truth:** the [root README](../../README.md) and the developer docs under [../developers/](../developers). This page is a derived view; when they disagree, the design docs win.

## Every fee in the system

| Fee | Amount | Paid by | Goes to — and when |
|---|---|---|---|
| Trade fee (treasury) | **1%** of the ETH side, both directions (100 bps <!-- m0:fees.tradeFeeBps -->) | trader, on every curve trade | accrues in the curve; swept to the treasury Safe by anyone via `sweepFees()` |
| **Creator fee** | **0.5%** of the ETH side, both directions (50 bps <!-- m0:fees.creatorFeeBps -->) — additive with the trade fee, total hard-capped at **2%** in code | trader, on every curve trade | accrues in the curve; swept to the **`CreatorVault`** via `sweepCreatorFees()`, then claimed by **the token's creator** |
| Creation fee | flat **0.000847 ETH** (847000000000000 wei <!-- m0:fees.creationFeeWei -->) | creator, once, at launch | treasury Safe |
| Graduation fee | flat, cost-based (migration gas + thin margin), **not** a % of the raise — **0.000225 ETH** (225000000000000 wei <!-- m0:fees.graduationFeeWei -->) | deducted from the raised ETH at graduation | treasury Safe |
| Graduation caller reward | flat **0.002824 ETH** (2824000000000000 wei <!-- m0:fees.callerRewardWei -->) | protocol (from the curve's balance) | **whoever calls `graduate()`** — in normal operation the platform **keeper** bot; permissionless, so anyone who calls first claims it |
| Post-graduation pool fee | Uniswap v3 **1% fee tier** (10000 <!-- m0:v3.feeTier -->) | traders on Uniswap, after graduation | the LP position; collected via the fee vault and **split 50/50 treasury / creator** |

**Total on a curve trade: 1.5%** — 1% to the treasury + 0.5% to the creator, both on the ETH side of every buy and sell. The two are separate, independently-floored legs and their sum can never exceed the **2%** ceiling written into the contract.

There are no other fees: no listing fee, no graduation percentage cut, no withdrawal fee, no fee on transfers.

### Where these numbers come from

Percentages and caps are fixed in the contracts. The flat ETH amounts and the 0.5% creator rate above are the **current live testnet deploy** (chain 46630, redeployed with creator fees 2026-07-13) — sourced from `tools/m0/out/constants.json` and read directly from the factory on-chain, not hardcoded here. ETH-pegged values are deploy-time snapshots: they are **re-derived and re-locked before mainnet**, and no USD figure is ever stored on-chain. On **mainnet the creator rate is decided at 0.5%** and re-locked against fresh economics before deploy.

## How creators earn — who, when, and how much

Creator earnings are **live**, not a promise. The plumbing is a per-creator pull-payment escrow, `CreatorVault`.

- **How much.** A creator earns the **creator-fee leg of every curve trade on their token** — **0.5%** of the ETH side, symmetric on buys *and* sells (the same rate a buyer or seller pays). It is *additive* to the 1% treasury fee, and the contract guarantees `treasuryFee + creatorFee ≤ 2%`.
- **When they earn it on the curve.** On **every buy and every sell while the token is on the bonding curve**. Each trade credits the creator's escrow; there is nothing the creator has to do to accrue it.
- **When they earn it after graduation.** The creator keeps earning. The graduated token's Uniswap v3 pool charges a 1% trading fee; when the fee vault's `collect()` harvests it, the accrued fees are **split 50/50 between the treasury and the creator**, with the creator's half routed to the `CreatorVault`. Because the split is 50% of the pool's 1% fee, the creator earns **0.5% of post-graduation volume** — the same 0.5%-of-volume rate as on the curve, with no discontinuity at the graduation seam.
- **When they get paid.** Anytime. The curve fee accrues inside the curve (it is *never* pushed to the creator during a trade); a permissionless `sweepCreatorFees()` moves it into the `CreatorVault`, and `claim()` pays the creator. The post-graduation share arrives in the `CreatorVault` whenever anyone calls `collect()`. Anyone can trigger the sweeps and the claim, but the value can **only ever** go to the creator address that earned it — no one can redirect it.

**Why creator fees can never freeze your sell.** Exactly like the treasury fee, the creator leg accrues *in the curve* and no buy or sell ever calls the creator or the vault. A broken or hostile creator address can at worst make its own `claim()` revert (retriable once fixed) — it can never make a trade revert. Exits never depend on a fee recipient behaving.

### How ROBBED_ compares

pump.fun pays creators a tiered share of trading volume; Raydium LaunchLab gives graduated creators a share of LP fees; Clanker-style deployments split pool fees with creators. ROBBED_ pays creators a straight **0.5% of volume on the curve and 0.5% of volume after graduation** (the 50/50 split of the pool's 1% fee), with the mainnet rate re-locked against real economics before launch.

## How the trade fee moves — and why you can always sell

The 1% treasury fee and the 0.5% creator leg are **never sent anywhere during your trade**. They accrue inside the curve contract, and separate functions — `sweepFees()` → treasury and `sweepCreatorFees()` → `CreatorVault`, callable by anyone at any time, in any phase — push the accumulated totals out.

This is a load-bearing design choice, not an accounting detail: because no buy or sell ever transfers ETH to the treasury or the creator, a broken or hostile recipient can at worst make a *sweep* revert (and it can simply be retried later). It can never make a sell revert. Exits do not depend on any fee recipient behaving.

The treasury itself is a Gnosis Safe — a standard, audited multisig, never a bespoke contract.

## What happens to liquidity fees after graduation

At graduation the raised ETH and the reserved token tranche become a full-range Uniswap v3 position in the token's 1%-tier pool. The position NFT is held by `LPFeeVault`, a small contract with no owner and no withdraw function; its only external function is `collect()`, which harvests the accrued trading fees and routes them to the fixed treasury (its 50% half) and the `CreatorVault` (the creator's 50% half).

The canonical one-line description used throughout the product: **LP principal permanently locked; trading fees claimable by treasury**. Nobody, including the protocol, can ever pull the principal back out — `collect()` harvests fees without ever touching the liquidity. (In the creator-fee generation the collected fees are split 50/50 with the creator, as above; the one-liner's fees clause is scheduled to flip to read "…split between treasury and creator" when the mainnet generation deploys.)

## Fee questions, quickly

- **How much does a creator make?** 0.5% of the ETH side of every buy and sell on their token while it's on the curve, and 0.5% of volume afterwards via the pool-fee split. On a token that trades 10 ETH of volume before graduating, that's ~0.05 ETH accrued to the creator on the curve alone.
- **How does a creator get paid?** Their share accrues automatically; anyone can call `sweepCreatorFees()` then `CreatorVault.claim()` (curve leg) or `collect()` then `CreatorVault.claimERC20()` (post-grad leg), and the value goes only to the creator address. In the app this is a one-click "claim".
- **Do creators earn after graduation?** Yes — the Uniswap pool's 1% fees are split 50/50 treasury/creator; the creator's half is claimable from the `CreatorVault`.
- **Do I pay the trade fee on sells too?** Yes — 1% treasury + 0.5% creator of the ETH you receive, symmetric with buys.
- **Can fees be raised on my token later?** The total trade fee is capped at 2% in code, and fee parameters for a launched curve are **immutable** — an owner retune can never touch a live curve.
- **Who pays for graduation?** A flat cost-based fee comes out of the raise, and the caller reward incentivizes triggering it — the platform keeper claims that reward in normal operation, though `graduate()` stays permissionless. Both the fee and the reward are protocol constants, not percentages.
- **Can I earn the graduation reward?** In principle yes — `graduate()` is permissionless — but a keeper bot auto-fires graduation within a block or two, so in practice it collects the reward. The reliable way a user earns on ROBBED_ is by **launching a token and collecting its creator fees** (above), not by racing the keeper.
- **Does the team earn from LP after graduation?** The treasury claims its 50% half of the Uniswap position's trading fees via the vault; the principal is untouchable.
