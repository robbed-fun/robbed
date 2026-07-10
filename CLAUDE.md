# ROBBED_ — Pump.fun-style launchpad on Robinhood Chain

Source of truth: `launchpad-spec.md` (v1.1). When code and spec disagree, the spec wins; when the spec is silent, ask or record the decision in §12/§13.

## Hard rules (violations are bugs, not style)

- **Never use `block.number`** for any logic — on Orbit chains it returns an L1 estimate. Use `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp` (spec §2, §6.5).
- **Compiler: one exact pin, no ranges** across the whole Foundry workspace. Candidate `0.8.35` — must be confirmed against Robinhood Blockscout verification before first deploy (§6.7).
- **Sells are always open.** No flag, pause, or code path may ever block curve sells. Pause flags are granular: `pauseCreates`, `pauseBuys` only. No pause authority of any kind post-graduation (§6.5). Two carve-outs are *not* pauses: the deterministic `ReadyToGraduate` lock (both directions locked pending permissionless `graduate()`, §12.12), and — critically — **trade fees never push ETH to the treasury**: the 1% fee accrues in-contract and is withdrawn by a permissionless, non-phase-gated `sweepFees()`, so a hostile/reverting treasury cannot freeze sells (§12.25).
- **LP copy language:** always "LP principal permanently locked; trading fees claimable by treasury." Never "burned" (unless the V2 fallback is explicitly adopted, which flips the copy).
- **Fees computed in-contract** — never caller-supplied fee amounts (§4.1).
- **Never hardcode market metrics** (TVL, prices, ETH/USD, volumes) in code, copy, or docs — cite source + timestamp or query live (§2).
- Immutable contracts, no proxies. Upgrade = new factory version (§6).
- OZ v5 throughout: SafeERC20, ReentrancyGuard, Ownable2Step. Treasury = Gnosis Safe, never a bespoke multisig (§6.6).
- LPFeeVault: no owner, no withdraw, sole external fn `collect(tokenId)` → fixed treasury. Keep it ~50 lines (§6.3, §6.6).
- License: MIT. All contracts verified on Blockscout at deploy; repo public.

## Chain facts (chain ID 4663)

- Gas token ETH; ~100ms blocks; single FCFS sequencer — priority fees do not jump the queue.
- WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Uniswap v2 Factory `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`, v2 Router02 `0x89e5db8b5aa49aa85ac63f691524311aeb649eba`.
- **Uniswap v3 confirmed on 4663 (§12.28)** — Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, NonfungiblePositionManager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`. Still assert at deploy: `factory.feeAmountTickSpacing(10000)==200`, `NPM.factory()`/`NPM.WETH9()`. Trade fee stays 1%.
- Explorer: robinhoodchain.blockscout.com
- Confirmation tiers everywhere in UX: soft-confirmed → posted-to-L1 → finalized (§2.1).

## Stack

- Monorepo: **pnpm workspaces** (dependency management, strict node_modules — https://pnpm.io/workspaces); **Bun stays the runtime and test runner** (§8/§9). One lockfile: `pnpm-lock.yaml`. Internal deps via `workspace:*`; shared lib versions via pnpm catalogs.
- **Anti-drift rule:** every cross-service type/schema/ABI lives ONCE in `packages/shared` (Zod-first, TS types via `z.infer`); any logic used by ≥2 services is extracted to `packages/*`. Apps import — never redeclare. `packages/*` and workspace config are owned by the `robbed-shared` agent.
- Contracts: Solidity + Foundry + OpenZeppelin v5, `contracts/` (LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault)
- Indexer: Ponder → Postgres (+pg_trgm) + Redis pub/sub → Bun WS
- API: Hono on Bun (API-mediated R2 uploads — §12.19; moderation, search)
- Frontend: Next.js 16 + React 19 (exact majors, no ranges — §12.37) App Router on Bun, wagmi v2 + viem + RainbowKit, TanStack Query, lightweight-charts, Tailwind dark-first, satori OG
- Tests: Foundry unit/fuzz/invariant + fork tests vs live chain; Vitest units; Playwright e2e on fork

## Security gates (all 10 required before caps lift — §10)

Key invariants the test suite must hold: `k` non-decreasing from trades; curve solvency under any fill sequence; exact fee accounting; graduation single-fire and reachable; post-grad curve holds zero value; pre-seeded/donated/swapped V3 pool cannot cause hostile-ratio mint; no actor sequence extracts ETH beyond fair curve value.

## Milestones

M0 parameter notebook → M1 contracts + gates 1–4 → M2 indexer/API → M3 frontend → M4 gates 5–8 → M5 caps lift. Portfolio/creator-fees/4337 are Phase 2 — but schema tracks `creator` per token and `creatorFeeBps` (hardcoded 0) from day 1.

## Docs-first rule

Before any implementation step, consult current official documentation for every library/tool being touched — never code from memory. Primary channel: the **context7 MCP server** (configured in `.mcp.json`: `resolve-library-id` → `get-library-docs`); fallback: WebFetch of canonical docs. Each agent in `.claude/agents/` carries its own curated doc-link list. Docs beat assumptions; the spec beats docs (flag the conflict).

## Agents

Specialized subagents live in `.claude/agents/`. Use `robbed-architect` for spec interpretation, decision arbitration, and authoring new agents/skills/commands. Delegate contract work to `robbed-contracts`, indexer/API to `robbed-indexer`, frontend to `robbed-frontend`, security gates to `robbed-security`, and anything in `packages/*` or workspace config to `robbed-shared`.
