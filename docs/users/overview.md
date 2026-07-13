# How ROBBED_ works

**Audience:** anyone using the product — creators launching a token, traders buying and selling one. No engineering background assumed.
**Source of truth:** [../spec.md](../spec.md). This page is a derived view; when they disagree, the spec wins.

## The short version

- Anyone can launch a token in **one transaction** for a flat fee of roughly a dollar or two (§5.3, §6.4). No code, no presale, no team allocation, no vesting.
- Every token starts on a **bonding curve** — an automated market where a formula sets the price: buys push it up, sells push it down (§4.1, §6.2). ROBBED_ is an AMM with soft confirmations, not an order book or real-time exchange (§1).
- Every trade pays a **1% fee** to the treasury (§6.4) — and, where it is switched on, a second small leg to the token's **creator** (currently **0.5%** on testnet; additive, total hard-capped at **2%** in code). Creators earning a cut of every trade on their own token is a **live feature**, not a promise (§7, §12.63). Full breakdown: [fees.md](fees.md).
- **Selling is always possible.** No flag, pause, or code path can ever block a curve sell — this is a hard protocol rule, enforced by construction, not policy (§6.5, §12.25). Details: [trading.md](trading.md).
- When the curve raises its ETH target, the token **graduates**: anyone can trigger the move of its liquidity into a Uniswap v3 pool, where trading continues outside anyone's control (§6.3). LP principal permanently locked; trading fees claimable by treasury (§12.14). Details: [graduation.md](graduation.md).

## How you can earn on ROBBED_

Two honest paths — and one that is no longer yours:

- **Launch a token and earn creator fees.** This is the one built-in way the launchpad pays *you*. As a creator you earn a cut of **every** trade on your token while it is on the curve — the creator-fee leg, live now at **0.5%** on testnet, symmetric on buys *and* sells, additive to the 1% treasury fee and hard-capped at 2% total. It accrues automatically, you claim it anytime, and it can never be redirected or freeze anyone's sell (§7, §12.63). On mainnet the rate is a deploy-time decision — the spec's v1 default is 0, so it may launch at 0 or a re-locked non-zero value. Details: [fees.md](fees.md).
- **Trade the curve (or the Uniswap pool after graduation).** You can buy low and sell higher — but this is **speculation, not yield**: the price is set purely by trading, the curve math rounds a hair in the protocol's favor, and most launchpad tokens go to zero. There is no staking, no yield, no airdrop, no dividend — just the market ([trading.md](trading.md)).
- **The graduation reward is now the keeper's.** `graduate()` pays its caller a small flat reward and stays permissionless, but the platform keeper auto-fires it, so in normal operation the keeper collects it, not you (§12.66, [graduation.md](graduation.md)).

## The lifecycle, step by step

Every token moves through the same three stages. There is no other path — no token skips a stage, and no one can move a token backwards.

### 1. Create

A creator picks a name, ticker, and image, optionally adds links and a first buy, and signs a single transaction (§5.3). Under a second later the token exists on-chain with a fixed supply of 1,000,000,000 and is live for trading. The token contract is ownerless: no one — including the creator — can mint more, tax transfers, or blacklist holders (§6.1). Full walkthrough: [token-creation.md](token-creation.md).

### 2. Trade on the curve

About 79% of the supply is for sale on the bonding curve; the rest is reserved for the graduation liquidity (§6.4). The price follows a constant-product formula seeded with virtual reserves, so the very first buy already has a well-defined price and early buyers pay less than later ones (§6.2). Trades confirm at sequencer speed (~100ms); a 1% fee applies on the ETH side of every buy and sell. How pricing, slippage, and the anti-sniper window work: [trading.md](trading.md).

### 3. Graduate

When the curve has raised its fixed ETH target — about $69k in market cap terms, set at deploy time (§6.4, §12.4) — trading on the curve stops and the token **graduates**. `graduate()` is permissionless: anyone may call it and collect a small reward. In normal operation you never have to — ROBBED_ runs a **keeper** (a bot) that auto-fires graduation within a block or two of the target and collects that reward; the permissionless path stays as a fallback if the keeper is ever down (§12.66). The raised ETH plus the reserved token tranche become a full-range Uniswap v3 position; the position's ownership NFT goes into a vault that no one can withdraw from. From that moment the token trades on Uniswap like any other asset, and no ROBBED_ contract has any authority over it (§6.3, §6.5). Details: [graduation.md](graduation.md).

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
