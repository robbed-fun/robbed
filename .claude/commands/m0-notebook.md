---
description: "Milestone 0 — build the parameter notebook under tools/m0/: curve constants from live ETH/USD (cited), virtual-reserve math, price/mcap plots, V3 tick math for graduation, LP tranche sizing; emits a constants file for Foundry deploy scripts and the frontend."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

Build **Milestone 0**: the parameter notebook that derives all deploy-time curve constants, as a runnable **TypeScript/Bun** script under `tools/m0/`. Inputs from the economics targets and virtual-reserve curve math in `docs/developers/contracts.md`; output consumed by both `contracts/script/` deploy scripts and `apps/web`. `$ARGUMENTS` may override the ETH/USD source or request recompute-only.

## Non-negotiables

- **No hardcoded market metrics** (the always-on `no-market-metrics` rule): ETH/USD comes from a live query at run time (CoinGecko/DefiLlama API — pick one, record which), and the output embeds `ethUsdSource` (URL/endpoint), `ethUsdPrice`, and `fetchedAt` ISO timestamp. If the fetch fails, the script exits nonzero — it never falls back to a baked-in price.
- Constants are **fixed at deploy** (economics targets, `docs/developers/contracts.md`): the notebook is the single derivation authority; nothing downstream re-derives them ad hoc.
- All ETH amounts in wei as decimal strings (safe for both Solidity and JS); include human-readable ETH mirrors for review.
- Final tick/constants are an **open item in the design decisions log** (`docs/developers/design-decisions.md`) until this notebook's output is reviewed — say so in the output header.

## Files to produce

```
tools/m0/
├── package.json          // @robbed/m0, bun script: "derive": "bun run derive.ts"
├── derive.ts             // main: fetch ETH/USD → derive → validate → emit
├── lib/curve.ts          // virtual-reserve constant-product math
├── lib/v3tick.ts         // V3 tick math for graduation price (1% tier, tickSpacing 200)
├── lib/plot.ts           // price & mcap curves → SVG (or gnuplot-free ASCII/HTML) under tools/m0/out/
└── out/
    ├── constants.json    // canonical machine output (git-committed, with provenance block)
    ├── Constants.sol.txt // Solidity constants block ready to paste/import into contracts/script/
    └── plots/            // price-vs-tokens-sold, mcap-vs-tokens-sold
```

`constants.json` is the canonical artifact; the `.sol` rendering and the frontend import (`packages/shared` re-export or direct JSON import) must be generated from it, never hand-edited.

## What to derive (economics targets from `docs/developers/contracts.md`)

1. **Supply split**: `TOTAL_SUPPLY = 1_000_000_000e18` (fixed); `CURVE_SUPPLY ≈ 793.1M` (79.31%); `LP_TOKEN_TRANCHE ≈ 206.9M` (20.69%) — pump.fun ratio. Emit exact integers that sum to total supply.
2. **Graduation ETH threshold**: `GRADUATION_ETH` such that graduation mcap ≈ **$69k equivalent** at the fetched ETH/USD (spot price × 1B supply at the curve's terminal price = target mcap). Show the algebra in comments.
3. **Virtual reserves** (curve math, Gnad-style): solve `virtualEth₀`, `virtualToken₀` with `k = virtualEth × virtualToken` such that (a) selling exactly `CURVE_SUPPLY` tokens raises `GRADUATION_ETH` real ETH (net of the 1% fee — state explicitly whether the threshold counts gross or net, and flag that choice for the design decisions log), and (b) the terminal curve spot price equals the graduation-mcap price. Buy formula `tokensOut = virtualToken − k/(virtualEth + ethIn)`; sell is the inverse.
4. **V3 graduation price & tick** (graduation, `docs/developers/contracts.md`): compute `sqrtPriceX96` for the terminal price in token/WETH terms — handle token-ordering (token0/token1 by address is unknowable pre-deploy, so emit **both orderings**) — and the nearest usable tick for the 1% fee tier (tickSpacing 200), plus full-range min/max usable ticks. This is the price the pool is initialized at during token creation (pre-seed defense) and the migrator's arb-back target.
5. **LP tranche sizing check**: verify `LP_TOKEN_TRANCHE` + raised ETH (as WETH) mint at the graduation price ratio into the full-range position without leaving more than dust; report expected residual dust (which the migrator burns).
6. **Fees** (economics targets): `TRADE_FEE_BPS = 100` (1%), `FEE_CAP_BPS = 200` (≤2% hard cap), `creatorFeeBps = 0` (creator fees are Phase 2); `CREATION_FEE_WEI` ≈ $1–2 equivalent at fetched ETH/USD; `GRADUATION_FEE_WEI` flat pump.fun-analog (derive from a stated comparable, cite it).
7. **Anti-sniper params** (sells-always-open / anti-sniper rules, `docs/developers/contracts.md`): `EARLY_WINDOW_SECONDS` (5–10s candidate) and `MAX_EARLY_BUY` wei — propose values with reasoning; mark as review-required.

## Validation (in-script, must pass before emitting)

- Round-trip: simulate buying the full curve in randomized chunk sequences → raised ETH within tolerance of `GRADUATION_ETH`, terminal price within tolerance of the V3 init price; `k` invariant holds at every step.
- Tick sanity: `sqrtPriceX96` → tick → price round-trips within one tickSpacing.
- Supply conservation: curve sold + LP tranche + dust = 1B exactly.
- Plots generated: price vs tokens-sold and mcap vs tokens-sold with the graduation point marked.

## Definition of done

`bun run derive` in `tools/m0/` exits 0, writes `out/constants.json` (with provenance: source, price, timestamp, git SHA), `out/Constants.sol.txt`, and plots; all validations pass; no literal USD/ETH prices anywhere in source (only targets like "$69k parity" from the economics targets, which are protocol constants, clearly commented with their `docs/developers/contracts.md` origin). Report: derived values table, the ETH/USD source + timestamp used, the gross-vs-net-fee threshold decision flagged for robbed-architect (for the design decisions log), and a reminder that gate approval of final constants closes that open item.
