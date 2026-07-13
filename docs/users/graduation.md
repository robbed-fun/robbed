# Graduation

**Audience:** anyone holding or watching a token near its target. What triggers graduation, the brief lock, who fires it (a keeper bot in normal operation; anyone as a fallback — for a reward), and what the token looks like afterwards.
**Source of truth:** [../spec.md](../spec.md) (§6.2, §6.3, §12.11, §12.12). This page is a derived view; when they disagree, the spec wins.

## What graduation is

Graduation is the one-way move of a token from its bonding curve to a normal **Uniswap v3 pool**. The ETH raised by the curve plus the reserved ~20.69% token tranche become permanent, full-range liquidity; from then on the token trades on Uniswap, outside the control of ROBBED_, the creator, and everyone else (§6.3, §6.5).

Every token has the same fixed target, known from the moment it launches. Nothing else triggers graduation — not time, not holder count, not anyone's decision.

## The trigger

The curve graduates when its **real ETH reserves — net of fees — reach the graduation target** (§6.2, §12.11): currently **7.916610 ETH**, sized to land at roughly a **$69k market cap** in the spirit of pump.fun parity (§12.4). The ETH figure comes from the M0 economics lock of 2026-07-12 at ETH/USD $1,817.62, CoinGecko (§12.62); like all ETH-pegged constants it is re-derived before mainnet deploy and fixed forever per factory version.

The buy that crosses the line is **clamped to land exactly on the target** — any excess ETH is refunded in the same transaction rather than overshooting (§12.11). If the clamped fill would violate that buyer's slippage floor, the trade reverts like any other; no silent partial fill (§6.5).

## The brief lock before the move

The moment the target is hit, the curve enters a `ReadyToGraduate` state: **both buys and sells lock** until graduation executes (§12.12). Two things make this different from a pause:

- **No one has authority over it.** No admin caused it, and no admin can extend it — it is a deterministic consequence of the curve filling, defined in immutable code.
- **Anyone can end it**, by calling `graduate()` — and gets paid for doing so.

The UI shows the token as “Graduating…” in both directions while this state lasts. In practice it lasts a block or two: ROBBED_'s keeper fires `graduate()` almost immediately (see below).

## Who pulls the trigger — the keeper, or anyone

`graduate()` is **permissionless**: any address may call it, and the caller receives a fixed reward — currently **0.002751 ETH** (~$5 equivalent at the §12.62 snapshot), deliberately sized at a multiple of the gas cost so triggering is always profitable (§12.34). In normal operation ROBBED_'s **keeper** — a small off-chain bot that watches for curves hitting the target — fires `graduate()` within a block or two and collects that reward (§12.66). Nothing depends on it, though: the keeper holds **no special authority** and cannot block or delay anyone; if it is ever down, any bot, holder, or stranger can call `graduate()` first, claim the reward, and the system works exactly the same. On the single first-come-first-served sequencer the keeper is simply one more caller racing for the reward — which is why the graduation reward is the keeper's in practice, not a reliable way for a user to earn (§12.66, §12.12).

What the call does, in order (§6.3):

1. Deducts a small **flat, cost-based graduation fee** — currently 0.000122 ETH; explicitly *not* a percentage of the raise (§12.26) — to the treasury.
2. **Checks the pool price.** The token's Uniswap pool was created and initialized at launch at the deterministic graduation price, precisely so nobody could pre-set a fake one. If someone has traded the pool's price away from the target anyway, the migrator **arbs it back using curve inventory before minting** — and if the price cannot be recovered, it reverts rather than mint at a hostile ratio (§6.3, §12.33). There is no sequence of donations, swaps, or pre-seeding that makes the protocol supply liquidity at a manipulated price.
3. **Mints the liquidity**: all raised ETH (as WETH) plus the ~206.9M reserved tokens go into a **full-range position in the 1%-fee-tier pool**, with minimum-amount checks enforced (§6.3, §12.28).
4. **Locks the position away.** The position NFT is transferred to `LPFeeVault` — a contract with no owner and no withdraw function whose only external call, `collect()`, sends accrued trading fees to the treasury (§6.3). LP principal permanently locked; trading fees claimable by treasury (§12.14).
5. **Sweeps the dust.** Full-range math leaves crumbs: leftover tokens go to the dead address (`0x…dEaD`), leftover WETH goes to the treasury — real ETH value is never destroyed (§12.13).

Graduation **fires exactly once**. The phase flips to `Graduated` before any external interaction, so it cannot be re-entered, re-run, or double-minted (§6.3). Afterwards the curve is empty by invariant — it holds nothing but any not-yet-swept trade fees.

## Life after graduation

- Trading happens on Uniswap v3 like any other token; price discovery is entirely market-driven.
- **No ROBBED_ contract has any authority over the token or the pool** — no pause, no admin, nothing (§6.5).
- The treasury periodically claims the pool's trading fees through the vault; the liquidity principal is permanently out of everyone's reach (§12.14).
- The curve contract stays on-chain as a historical artifact holding zero value (§6.3).

## Honest notes

- **Graduation is not an endorsement or a price floor.** It is a liquidity milestone. Tokens can and do fall below their graduation price afterwards.
- **Most tokens never graduate.** A curve that never fills keeps trading normally — selling remains open the whole time ([trading.md](trading.md)).
- **Could someone jam the lock?** The security program red-teamed exactly this: keeping a curve stuck in `ReadyToGraduate` costs an attacker real ETH at zero profit, while any third party can end it at a profit — and the fork-tested verdict ratified shipping without a timeout hatch (§12.61).
