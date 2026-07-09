---
description: "Milestone 0 — build the parameter notebook under tools/m0/: curve constants from live ETH/USD (cited), virtual-reserve math, price/mcap plots, V3 tick math for graduation, LP tranche sizing; emits a constants file for Foundry deploy scripts and the frontend."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch
---

Build **Milestone 0** (spec §11.0): the parameter notebook that derives all deploy-time curve constants, as a runnable **TypeScript/Bun** script under `tools/m0/`. Inputs from spec §6.4 (economics targets) and §6.2 (curve math); output consumed by both `contracts/script/` deploy scripts and `apps/web`. `$ARGUMENTS` may override the ETH/USD source or request recompute-only.

## Non-negotiables

- **No hardcoded market metrics** (§2): ETH/USD comes from a live query at run time (CoinGecko/DefiLlama API — pick one, record which), and the output embeds `ethUsdSource` (URL/endpoint), `ethUsdPrice`, and `fetchedAt` ISO timestamp. If the fetch fails, the script exits nonzero — it never falls back to a baked-in price.
- Constants are **fixed at deploy** (§6.4, §12.4): the notebook is the single derivation authority; nothing downstream re-derives them ad hoc.
- All ETH amounts in wei as decimal strings (safe for both Solidity and JS); include human-readable ETH mirrors for review.
- Final tick/constants are open item **§13** until this notebook's output is reviewed — say so in the output header.

## Files to produce

```
tools/m0/
├── package.json          // @hoodpad/m0, bun script: "derive": "bun run derive.ts"
├── derive.ts             // main: fetch ETH/USD → derive → validate → emit
├── lib/curve.ts          // virtual-reserve constant-product math (§6.2)
├── lib/v3tick.ts         // V3 tick math for graduation price (1% tier, tickSpacing 200)
├── lib/plot.ts           // price & mcap curves → SVG (or gnuplot-free ASCII/HTML) under tools/m0/out/
└── out/
    ├── constants.json    // canonical machine output (git-committed, with provenance block)
    ├── Constants.sol.txt // Solidity constants block ready to paste/import into contracts/script/
    └── plots/            // price-vs-tokens-sold, mcap-vs-tokens-sold
```

`constants.json` is the canonical artifact; the `.sol` rendering and the frontend import (`packages/shared` re-export or direct JSON import) must be generated from it, never hand-edited.

## What to derive (targets from §6.4)

1. **Supply split**: `TOTAL_SUPPLY = 1_000_000_000e18` (fixed); `CURVE_SUPPLY ≈ 793.1M` (79.31%); `LP_TOKEN_TRANCHE ≈ 206.9M` (20.69%) — pump.fun ratio. Emit exact integers that sum to total supply.
2. **Graduation ETH threshold**: `GRADUATION_ETH` such that graduation mcap ≈ **$69k equivalent** at the fetched ETH/USD (spot price × 1B supply at the curve's terminal price = target mcap). Show the algebra in comments.
3. **Virtual reserves** (§6.2, Gnad math): solve `virtualEth₀`, `virtualToken₀` with `k = virtualEth × virtualToken` such that (a) selling exactly `CURVE_SUPPLY` tokens raises `GRADUATION_ETH` real ETH (net of the 1% fee — state explicitly whether the threshold counts gross or net, and flag that choice for §12), and (b) the terminal curve spot price equals the graduation-mcap price. Buy formula `tokensOut = virtualToken − k/(virtualEth + ethIn)`; sell is the inverse.
4. **V3 graduation price & tick** (§6.3): compute `sqrtPriceX96` for the terminal price in token/WETH terms — handle token-ordering (token0/token1 by address is unknowable pre-deploy, so emit **both orderings**) — and the nearest usable tick for the 1% fee tier (tickSpacing 200), plus full-range min/max usable ticks. This is the price the pool is initialized at during token creation (pre-seed defense, §6.3.2) and the migrator's arb-back target.
5. **LP tranche sizing check**: verify `LP_TOKEN_TRANCHE` + raised ETH (as WETH) mint at the graduation price ratio into the full-range position without leaving more than dust; report expected residual dust (which the migrator burns, §6.3.5).
6. **Fees** (§6.4): `TRADE_FEE_BPS = 100` (1%), `FEE_CAP_BPS = 200` (≤2% hard cap), `creatorFeeBps = 0` (§7); `CREATION_FEE_WEI` ≈ $1–2 equivalent at fetched ETH/USD; `GRADUATION_FEE_WEI` flat pump.fun-analog (derive from a stated comparable, cite it).
7. **Anti-sniper params** (§6.5): `EARLY_WINDOW_SECONDS` (5–10s candidate) and `MAX_EARLY_BUY` wei — propose values with reasoning; mark as review-required.

## Validation (in-script, must pass before emitting)

- Round-trip: simulate buying the full curve in randomized chunk sequences → raised ETH within tolerance of `GRADUATION_ETH`, terminal price within tolerance of the V3 init price; `k` invariant holds at every step.
- Tick sanity: `sqrtPriceX96` → tick → price round-trips within one tickSpacing.
- Supply conservation: curve sold + LP tranche + dust = 1B exactly.
- Plots generated: price vs tokens-sold and mcap vs tokens-sold with the graduation point marked.

## Definition of done

`bun run derive` in `tools/m0/` exits 0, writes `out/constants.json` (with provenance: source, price, timestamp, git SHA), `out/Constants.sol.txt`, and plots; all validations pass; no literal USD/ETH prices anywhere in source (only targets like "$69k parity" from §6.4, which are spec constants, clearly commented with their §6.4 origin). Report: derived values table, the ETH/USD source + timestamp used, the gross-vs-net-fee threshold decision flagged for hoodpad-architect (§12/§13), and a reminder that gate approval of final constants closes the §13 open item.
