# Trading on the curve

**Audience:** traders. How prices form, what protections you have, what the protocol can and cannot pause, and how confirmations work.
**Source of truth:** the [root README](../../README.md) and the developer docs under [../developers/](../developers). This page is a derived view; when they disagree, the design docs win.

## How the price forms

Every token trades against its own bonding curve — a constant-product automated market maker (the same `x·y=k` family as Uniswap), seeded with *virtual reserves* so the very first buy already has a sane, well-defined price:

- **Buys push the price up, sells push it down.** Early buyers pay less than later buyers, deterministically.
- **There is no order book, no market maker, no counterparty** — just the formula. You always trade against the curve, and the math rounds in the protocol's favor by a hair, never yours.
- **A 1% treasury fee and a 0.5% creator fee apply to the ETH side of every trade**, both directions ([fees.md](fees.md)).

Robinhood Chain adds one fairness property worth knowing: it runs a single first-come-first-served sequencer, so paying a higher priority fee does **not** jump the queue. Sniping races here are latency races, not gas auctions.

## Your protections on every trade

- **Slippage floor + deadline.** Every trade (including a creator's initial buy) carries a minimum-out and a deadline; if the fill would be worse than your minimum, the whole trade reverts — there are no silent partial fills. The UI default is **2%**; you can tighten or widen it. On a very young, thin curve, trading with slippage protection switched off can cost you double-digit percentages to front-running — the default exists for a reason.
- **Anti-sniper window.** For the first seconds after a launch (currently 8s (8 <!-- m0:antiSniper.windowSeconds -->)), each buy transaction is capped — currently **0.143742 ETH** (143742000000000000 wei <!-- m0:antiSniper.maxEarlyBuyWei -->), which is 2.5% of the graduation target. This blunts single-transaction supply sweeps at launch. Honest caveat: a determined sniper can rotate wallets to work around it; the cap raises the cost, it does not make sniping impossible.
- **Beta caps (temporary).** Until the security-gate program completes, per-token and global **buy-side** ETH caps apply. They are lifted as gates pass — and they can never block a sell.

## Sells are always open

The strongest guarantee in the protocol: **no flag, pause, or code path can ever block a curve sell.** Concretely:

- The sell path reads no pause flag at all. The only pause switches that exist anywhere are `pauseCreates` and `pauseBuys`; there is no `pauseSells` to flip.
- Trade fees never touch the treasury or the creator during a trade — they accrue in-contract and move only via separate permissionless sweeps — so even a hostile or broken fee recipient cannot freeze exits.
- After graduation, the token trades on Uniswap and no ROBBED_ contract retains pause authority of any kind.

The one deliberate carve-out: in the moments between a curve hitting its graduation target and `graduate()` executing, **both** buys and sells lock. This is not a pause — no one has the authority to cause, extend, or keep it; it is a deterministic protocol state that anyone can end. In normal operation ROBBED_'s **keeper** ends it within a block or two (and collects the small reward); it stays permissionless as a fallback, so a stuck lock is not something an admin could cause or prolong. See [graduation.md](graduation.md).

## Confirmations: what “done” means

Robinhood Chain is an Arbitrum Orbit L2 settling to Ethereum, so a transaction becomes final in tiers:

1. **Sequencer inclusion** — sub-second; the trading UX runs at this speed.
2. **Posted to Ethereum** — the batch containing your trade is on L1.
3. **Finalized** — Ethereum finality; what matters for withdrawals and bridging.

For everyday curve trades, tier 1 is the working reality and the UI treats a fresh trade as simply *placed* — it makes no finality claim on it. For **large trades (≥ 1.0 ETH notional)** the UI explicitly surfaces posted-to-L1 / finalized status, and bridge or withdrawal flows always disclose the deeper tiers.

## Before you trade: a short checklist

- **Verify the token address.** Names and images are free-form; the contract address is the identity. The metadata hash committed at creation binds the token to its true name/ticker/image — the site surfaces this, but on-chain identity is the address.
- **Anyone can launch anything.** A token being listed means someone paid ~a dollar to create it, nothing more. Most launchpad tokens — here and everywhere — go to zero.
- **Graduation is not a target price.** It moves liquidity to Uniswap; it does not make a token valuable ([graduation.md](graduation.md)).
- **Check holder concentration** on the token page before sizing a position; a curve where a few wallets hold most of the supply behaves accordingly.
- **You can always exit** at the curve's current price — that is guaranteed. The *price itself* is not.
