# How ROBBED_ works

**Audience:** anyone using the product — creators launching a token, traders buying and selling one. No engineering background assumed.
**Source of truth:** [../spec.md](../spec.md). This page is a derived view; when they disagree, the spec wins.

## The short version

- Anyone can launch a token in **one transaction** for a flat fee of roughly a dollar or two (§5.3, §6.4). No code, no presale, no team allocation, no vesting.
- Every token starts on a **bonding curve** — an automated market where a formula sets the price: buys push it up, sells push it down (§4.1, §6.2). ROBBED_ is an AMM with soft confirmations, not an order book or real-time exchange (§1).
- Every trade pays a **1% fee** (§6.4). In v1 creators earn nothing per trade — creator fees are designed in but switched off until Phase 2 (§7). Full breakdown: [fees.md](fees.md).
- **Selling is always possible.** No flag, pause, or code path can ever block a curve sell — this is a hard protocol rule, enforced by construction, not policy (§6.5, §12.25). Details: [trading.md](trading.md).
- When the curve raises its ETH target, the token **graduates**: anyone can trigger the move of its liquidity into a Uniswap v3 pool, where trading continues outside anyone's control (§6.3). LP principal permanently locked; trading fees claimable by treasury (§12.14). Details: [graduation.md](graduation.md).

## The lifecycle, step by step

Every token moves through the same three stages. There is no other path — no token skips a stage, and no one can move a token backwards.

### 1. Create

A creator picks a name, ticker, and image, optionally adds links and a first buy, and signs a single transaction (§5.3). Under a second later the token exists on-chain with a fixed supply of 1,000,000,000 and is live for trading. The token contract is ownerless: no one — including the creator — can mint more, tax transfers, or blacklist holders (§6.1). Full walkthrough: [token-creation.md](token-creation.md).

### 2. Trade on the curve

About 79% of the supply is for sale on the bonding curve; the rest is reserved for the graduation liquidity (§6.4). The price follows a constant-product formula seeded with virtual reserves, so the very first buy already has a well-defined price and early buyers pay less than later ones (§6.2). Trades confirm at sequencer speed (~100ms); a 1% fee applies on the ETH side of every buy and sell. How pricing, slippage, and the anti-sniper window work: [trading.md](trading.md).

### 3. Graduate

When the curve has raised its fixed ETH target — about $69k in market cap terms, set at deploy time (§6.4, §12.4) — trading on the curve stops and **anyone** can call `graduate()` (and is paid a small reward for doing so). The raised ETH plus the reserved token tranche become a full-range Uniswap v3 position; the position's ownership NFT goes into a vault that no one can withdraw from. From that moment the token trades on Uniswap like any other asset, and no ROBBED_ contract has any authority over it (§6.3, §6.5). Details: [graduation.md](graduation.md).

Graduation is a milestone, not a promise: a token that never reaches the target simply keeps trading on the curve, and its price can go to zero.

## Safety by construction

These properties come from the contract design itself, not from anyone's good behavior:

- **Immutable contracts, no proxies.** What you see verified on Blockscout is what runs forever; upgrades mean a new factory, never a change under your feet (§6).
- **Sells cannot be frozen.** The sell path reads no pause flag, and trade fees are never pushed to the treasury mid-trade (they accrue in-contract and are swept by a separate permissionless call), so not even a hostile treasury can block exits (§6.5, §12.25).
- **The only pause switches are narrow:** `pauseCreates` and `pauseBuys`. No `pauseSells` exists anywhere in the code, and post-graduation there is no pause authority of any kind (§6.5).
- **Graduation cannot be captured.** It fires exactly once, anyone can trigger it, and the migrator refuses to mint liquidity at a manipulated price — it arbs the pool back to the correct price first or reverts (§6.3).
- **Fees are computed in-contract** from immutable parameters — never supplied by the caller (§4.1).

What safety does *not* mean: token prices are set purely by trading. Most launchpad tokens everywhere lose value; nothing here changes that.

## Where to next

| You are… | Read |
|---|---|
| Launching a token | [token-creation.md](token-creation.md) |
| Trading, or wondering if you can always sell | [trading.md](trading.md) |
| Checking what everything costs and who earns what | [fees.md](fees.md) |
| Watching a token near its graduation target | [graduation.md](graduation.md) |
| An engineer after ABIs, storage layouts, invariants | [contracts.md](../developers/contracts.md), [indexer.md](../developers/indexer.md), [api.md](../developers/api.md), [web.md](../developers/web.md) |
| After the normative protocol definition | [../spec.md](../spec.md) |
