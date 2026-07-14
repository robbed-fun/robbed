# Graduation

**Audience:** anyone holding or watching a token near its target. What triggers graduation, the brief lock, who fires it (a keeper bot in normal operation; anyone as a fallback — for a reward), and what the token looks like afterwards.
**Source of truth:** the [root README](../../README.md) and the developer docs under [../developers/](../developers). This page is a derived view; when they disagree, the design docs win.

## What graduation is

Graduation is the one-way move of a token from its bonding curve to a normal **Uniswap v3 pool**. The ETH raised by the curve plus the reserved ~20.69% token tranche become permanent, full-range liquidity; from then on the token trades on Uniswap, outside the control of ROBBED_, the creator, and everyone else.

Every token has the same fixed target, known from the moment it launches. Nothing else triggers graduation — not time, not holder count, not anyone's decision.

## The trigger

The curve graduates when its **real ETH reserves — net of fees — reach the graduation target**: currently **5.749693 ETH** (5749693301560943464 wei <!-- m0:curve.graduationEthWei -->). This is a **flat net-of-fee ETH target**, set at deploy time — not a market-cap figure. Like all ETH-pegged constants it is re-derived and re-locked before the mainnet deploy and fixed forever per factory version; the value comes from `tools/m0/out/constants.json`, never a hardcoded number.

The buy that crosses the line is **clamped to land exactly on the target** — any excess ETH is refunded in the same transaction rather than overshooting. If the clamped fill would violate that buyer's slippage floor, the trade reverts like any other; no silent partial fill.

## The brief lock before the move

The moment the target is hit, the curve enters a `ReadyToGraduate` state: **both buys and sells lock** until graduation executes. Two things make this different from a pause:

- **No one has authority over it.** No admin caused it, and no admin can extend it — it is a deterministic consequence of the curve filling, defined in immutable code.
- **Anyone can end it**, by calling `graduate()` — and gets paid for doing so.

The UI shows the token as “Graduating…” in both directions while this state lasts. In practice it lasts a block or two: ROBBED_'s keeper fires `graduate()` almost immediately (see below).

## Who pulls the trigger — the keeper, or anyone

`graduate()` is **permissionless**: any address may call it, and the caller receives a fixed reward — currently **0.002824 ETH** (2824000000000000 wei <!-- m0:fees.callerRewardWei -->), deliberately sized at a multiple of the gas cost so triggering is always profitable. In normal operation ROBBED_'s **keeper** — a small off-chain bot that watches for curves hitting the target — fires `graduate()` within a block or two and collects that reward. Nothing depends on it, though: the keeper holds **no special authority** and cannot block or delay anyone; if it is ever down, any bot, holder, or stranger can call `graduate()` first, claim the reward, and the system works exactly the same. On the single first-come-first-served sequencer the keeper is simply one more caller racing for the reward — which is why the graduation reward is the keeper's in practice, not a reliable way for a user to earn.

What the call does, in order:

1. Deducts a small **flat, cost-based graduation fee** — currently 0.000225 ETH (225000000000000 wei <!-- m0:fees.graduationFeeWei -->); explicitly *not* a percentage of the raise — to the treasury.
2. **Checks the pool price.** The token's Uniswap pool was created and initialized at launch at the deterministic graduation price, precisely so nobody could pre-set a fake one. If someone has traded the pool's price away from the target anyway, the migrator **arbs it back using curve inventory before minting** — and if the price cannot be recovered, it reverts rather than mint at a hostile ratio. There is no sequence of donations, swaps, or pre-seeding that makes the protocol supply liquidity at a manipulated price.
3. **Mints the liquidity**: all raised ETH (as WETH) plus the ~206.9M reserved tokens go into a **full-range position in the 1%-fee-tier pool**, with minimum-amount checks enforced.
4. **Locks the position away.** The position NFT is transferred to `LPFeeVault` — a contract with no owner and no withdraw function whose only external call, `collect()`, harvests the pool's accrued trading fees and splits them 50/50 between the treasury and the token's creator (via the `CreatorVault`), never touching the liquidity. LP principal permanently locked; trading fees claimable by treasury.
5. **Sweeps the dust.** Full-range math leaves crumbs: leftover tokens go to the dead address (`0x…dEaD`), leftover WETH goes to the treasury — real ETH value is never destroyed.

Graduation **fires exactly once**. The phase flips to `Graduated` before any external interaction, so it cannot be re-entered, re-run, or double-minted. Afterwards the curve is empty by invariant — it holds nothing but any not-yet-swept trade fees.

## Life after graduation

- Trading happens on Uniswap v3 like any other token; price discovery is entirely market-driven.
- **No ROBBED_ contract has any authority over the token or the pool** — no pause, no admin, nothing.
- The treasury and the creator each periodically claim their half of the pool's trading fees through the vault; the liquidity principal is permanently out of everyone's reach.
- The curve contract stays on-chain as a historical artifact holding zero value.

## Honest notes

- **Graduation is not an endorsement or a price floor.** It is a liquidity milestone. Tokens can and do fall below their graduation price afterwards.
- **Most tokens never graduate.** A curve that never fills keeps trading normally — selling remains open the whole time ([trading.md](trading.md)).
- **Could someone jam the lock?** The security program red-teamed exactly this on a live mainnet-fork: keeping a curve stuck in `ReadyToGraduate` costs an attacker real ETH at zero profit, is non-permanent, and any third party can end it at a profit — and the fork-tested verdict ratified shipping without a timeout hatch (see the gate 5/6 record in [design-decisions.md](../developers/design-decisions.md#curve-graduation--fee-mechanics)).
