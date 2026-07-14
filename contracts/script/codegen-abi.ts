#!/usr/bin/env bun
/**
 * M1-3 + M1-3b — shared ABI codegen, both compilation-time legs (contracts.md
 * legs 1–2; architecture.md).
 *
 * Compilation-time (NOT deploy-time) step: `forge build`, then:
 *
 * LEG 2 (M1-3b) — extract the complete `.abi` array (read + write
 * functions, errors, events — everything) of each of the six robbed contracts
 * from `contracts/out/<C>.sol/<C>.json` and emit:
 *
 *   packages/shared/src/abi/<C>.json   — the raw ABI array (one per contract)
 *   packages/shared/src/abi/index.ts   — a typed barrel that inlines each ABI
 *                                        with `as const` so viem/wagmi infer
 *                                        literal types (JSON imports cannot —
 *                                        viem.sh/docs/typescript).
 *
 * LEG 1 (M1-3) — extract the CANONICAL EVENT FRAGMENTS from the
 * same forge artifacts (incl. the vendored Uniswap interfaces, which declare
 * the upstream-verbatim V3 `Swap`/NPM `Collect`) and emit:
 *
 *   packages/shared/events.json        — canonical event ABI shapes, generated
 *                                        (never hand-written), cross-checked
 *                                        BYTE-FOR-BYTE against the spec-
 *                                        transcribed fragments in
 *                                        `src/abi/events.ts` before writing.
 *
 * Owned by the contracts pipeline (generated artifacts); live under
 * packages/shared per the anti-drift rule (single source; apps import, never
 * hand-write — architecture.md). Distinct from:
 *   - `events.ts` (hand-authored): the spec-transcribed canonical fragments the
 *     contracts must MATCH byte-for-byte; contract-first source of truth, NOT
 *     regenerated here (regenerating would invert the direction of truth).
 *     This script FAILS if an artifact diverges from it — that divergence is a
 * robbed-architect escalation (indexer.md / OI-1), never a codegen edit.
 *   - deploy-time `addresses` (M1-14): needs a broadcast; separate leg.
 *
 * Re-runnable:  bun contracts/script/codegen-abi.ts
 *
 * Verify (+ M1-3):
 *   forge build green; six ABI files exist;
 *   grep -q 'reserves' packages/shared/src/abi/BondingCurve.json
 *   grep -q '"config"' packages/shared/src/abi/CurveFactory.json
 *   grep -q 'metadataUri' packages/shared/events.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Spec-transcribed canonical fragments — the byte-for-byte baseline
// the extracted artifact fragments must match (direction of truth: spec → code).
import {
  graduatedEvent,
  tokenCreatedEvent,
  tradeEvent,
  transferEvent,
  v3CollectEvent,
  v3SwapEvent,
} from "../../packages/shared/src/abi/events";

/** The robbed contracts whose full ABIs cross the service seam. CreatorVault added by the
 * Phase-2 creator-fee landing (pull-payment vault mirrored by robbed-shared). */
const CONTRACTS = [
  "LaunchToken",
  "CurveFactory",
  "BondingCurve",
  "Router",
  "V3Migrator",
  "LPFeeVault",
  "CreatorVault",
] as const;
type ContractName = (typeof CONTRACTS)[number];

/**
 * Explicit const-name map. Derived casing would mangle the acronyms
 * (`V3Migrator` → `v3Migrator` ok, but `LPFeeVault` → `lPFeeVault` wrong), so
 * these are spelled out to keep the frontend/indexer import names clean.
 */
const VAR_NAME: Record<ContractName, string> = {
  LaunchToken: "launchTokenAbi",
  CurveFactory: "curveFactoryAbi",
  BondingCurve: "bondingCurveAbi",
  Router: "routerAbi",
  V3Migrator: "v3MigratorAbi",
  LPFeeVault: "lpFeeVaultAbi",
  CreatorVault: "creatorVaultAbi",
};

const here = dirname(fileURLToPath(import.meta.url)); // contracts/script
const contractsRoot = join(here, ".."); // contracts
const repoRoot = join(contractsRoot, ".."); // repo root
const outDir = join(contractsRoot, "out");
const abiDir = join(repoRoot, "packages", "shared", "src", "abi");

// ── 1. Compile (compilation-time leg — no deploy) ───────────────────────────
// Prepend the default foundryup bin dir so the step is robust when forge is not
// already on the caller's PATH (e.g. non-login shells / hooks).
const env = {
  ...process.env,
  PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH ?? ""}`,
};
console.log("[codegen-abi] forge build …");
const build = spawnSync("forge", ["build"], {
  cwd: contractsRoot,
  stdio: "inherit",
  env,
});
if (build.status !== 0) {
  console.error("[codegen-abi] forge build failed");
  process.exit(build.status ?? 1);
}

// ── 2. Extract each full ABI array from the Foundry artifact ─────────────────
mkdirSync(abiDir, { recursive: true });

type AbiItem = { type: string; name?: string };
const abis: Record<ContractName, AbiItem[]> = {} as Record<ContractName, AbiItem[]>;

for (const name of CONTRACTS) {
  const artifactPath = join(outDir, `${name}.sol`, `${name}.json`);
  if (!existsSync(artifactPath)) {
    console.error(`[codegen-abi] missing artifact: ${artifactPath}`);
    console.error("[codegen-abi] did `forge build` compile this contract?");
    process.exit(1);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi as AbiItem[] | undefined;
  if (!Array.isArray(abi) || abi.length === 0) {
    console.error(`[codegen-abi] empty/absent .abi in ${artifactPath}`);
    process.exit(1);
  }
  abis[name] = abi;

  // Raw ABI array — pretty-printed so the greps match and diffs are readable.
  writeFileSync(join(abiDir, `${name}.json`), `${JSON.stringify(abi, null, 2)}\n`);
}

// ── 2b. Sanity-assert the reads the consumers actually depend on ────
// Fails the codegen loudly if an ABI drifts out from under the frontend Trust
// panel / indexer curve-constants read, rather than shipping a silent gap.
const REQUIRED_FNS: Partial<Record<ContractName, string[]>> = {
  BondingCurve: ["reserves", "phase", "quoteBuy", "quoteSell", "TRADE_FEE_BPS", "buy", "sell"],
  // curveDefaults: factory-level curve-shape defaults for the pre-create Create-page
  // preview (LAUNCH-2) + indexer startup cache.
  CurveFactory: ["config", "curveDefaults", "createToken"],
  LaunchToken: ["metadataHash", "totalSupply"],
  LPFeeVault: ["collect"],
  // pull-payment creator-fee vault: the creator claim/deposit surface + read paths the
  // indexer (per-creator accrual) and portfolio "creator fees" read depend on.
  CreatorVault: ["deposit", "claim", "balanceOf", "factory"],
};
for (const [name, fns] of Object.entries(REQUIRED_FNS) as [ContractName, string[]][]) {
  const present = new Set(abis[name].filter((i) => i.type === "function").map((i) => i.name));
  const missing = fns.filter((f) => !present.has(f));
  if (missing.length) {
    console.error(`[codegen-abi] ${name} ABI is missing expected reads: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ── 3. Emit the typed barrel (const-asserted for viem/wagmi inference) ───────
const banner = `// GENERATED by contracts/script/codegen-abi.ts — DO NOT EDIT.
// Source: contracts/out/<C>.sol/<C>.json (forge build). Regenerate:
//   bun contracts/script/codegen-abi.ts
// Full read+write ABIs for the six robbed contracts (M1-3b).
// \`as const\` is mandatory: viem/wagmi infer literal types only from const
// ABIs, never from plain JSON imports (viem.sh/docs/typescript).
`;

const parts: string[] = [banner];

// Re-export the hand-authored canonical event fragments (M1-3) so `@robbed/shared/abi`
// remains a single import surface (events + full ABIs) after the export map is repointed.
parts.push(`export * from "./events";\n`);

// Re-export the pinned external Uniswap periphery ABIs (hand-curated in external.ts,
// frozen against the published artifacts by abi.external.test.ts). Emitted here so
// regenerating the barrel never drops the frontend's quoter/swap-router imports.
parts.push(
  `// External Uniswap v3-periphery ABIs (quoterV2Abi / swapRouter02Abi) — pinned to\n` +
    `// the deployed periphery, NOT generated from contracts/out. See external.ts.\n` +
    `export * from "./external";\n`,
);

for (const name of CONTRACTS) {
  const varName = VAR_NAME[name];
  parts.push(
    `/** Full ABI of ${name} (read + write). @generated */\n` +
      `export const ${varName} = ${JSON.stringify(abis[name], null, 2)} as const;\n`,
  );
}

// Name → ABI record for generic/iterating consumers (indexer registration etc.).
const mapEntries = CONTRACTS.map((n) => `  ${n}: ${VAR_NAME[n]},`).join("\n");
parts.push(
  `/** All six full contract ABIs keyed by contract name. @generated */\n` +
    `export const contractAbis = {\n${mapEntries}\n} as const;\n`,
);
parts.push(`export type ContractName = keyof typeof contractAbis;\n`);

writeFileSync(join(abiDir, "index.ts"), `${parts.join("\n")}`);

// ── 4. LEG 1 (M1-3) — canonical event fragments → packages/shared/events.json ─
//
// Allowlist per forge artifact: the cross-service canonical event families
// (TokenCreated, Trade, Graduated, Transfer, V3 Swap/Collect)
// plus the protocol lifecycle/fee events of contracts.md (GraduationReady,
// FeesSwept, PoolInitialized, LPFeeVault FeesCollected). Admin/config
// events and OZ ERC20/ERC721 noise are deliberately excluded — events.json is
// "canonical event fragments only" (contracts.md leg 1).
// The V3 Swap/Collect fragments come from the vendored upstream-verbatim
// interface artifacts, so nothing here is hand-written.
const EVENT_SOURCES: { artifact: string; events: string[] }[] = [
  { artifact: "CurveFactory", events: ["TokenCreated"] },
  { artifact: "BondingCurve", events: ["Trade", "GraduationReady", "FeesSwept", "CreatorFeesSwept"] },
  { artifact: "V3Migrator", events: ["PoolInitialized", "Graduated"] },
  { artifact: "LaunchToken", events: ["Transfer"] },
  { artifact: "LPFeeVault", events: ["FeesCollected"] },
  // creator-fee accrual + claim (pull-payment CreatorVault) — per-creator indexer feed.
  { artifact: "CreatorVault", events: ["CreatorFeeDeposited", "CreatorFeeClaimed"] },
  { artifact: "IUniswapV3Pool", events: ["Swap"] },
  { artifact: "INonfungiblePositionManager", events: ["Collect"] },
];

type AbiEventInput = { name: string; type: string; indexed?: boolean };
type AbiEventItem = { type: string; name?: string; inputs?: AbiEventInput[] };

/** Normalized shape for byte-for-byte comparison: names + types + indexed flags + order. */
function normalize(ev: {
  name: string;
  inputs: readonly { name: string; type: string; indexed?: boolean }[];
}): string {
  return JSON.stringify({
    name: ev.name,
    inputs: ev.inputs.map((i) => ({ name: i.name, type: i.type, indexed: i.indexed === true })),
  });
}

/**
 * Spec-transcribed baselines (events.ts) keyed by "<artifact>.<event>".
 * Extracted artifact fragments MUST match these byte-for-byte;
 * families without a hand-authored counterpart are artifact-canonical.
 */
const SPEC_BASELINE: Record<string, string> = {
  "CurveFactory.TokenCreated": normalize(tokenCreatedEvent),
  "BondingCurve.Trade": normalize(tradeEvent),
  "V3Migrator.Graduated": normalize(graduatedEvent),
  "LaunchToken.Transfer": normalize(transferEvent),
  "IUniswapV3Pool.Swap": normalize(v3SwapEvent),
  "INonfungiblePositionManager.Collect": normalize(v3CollectEvent),
};

const eventsByContract: Record<string, AbiEventItem[]> = {};
for (const { artifact, events } of EVENT_SOURCES) {
  const artifactPath = join(outDir, `${artifact}.sol`, `${artifact}.json`);
  if (!existsSync(artifactPath)) {
    console.error(`[codegen-abi] missing artifact for events.json: ${artifactPath}`);
    process.exit(1);
  }
  const abi = JSON.parse(readFileSync(artifactPath, "utf8")).abi as AbiEventItem[];
  const fragments: AbiEventItem[] = [];
  for (const name of events) {
    const frag = abi.find((i) => i.type === "event" && i.name === name);
    if (!frag) {
      console.error(`[codegen-abi] ${artifact} artifact is missing canonical event ${name}`);
      process.exit(1);
    }
    // byte-for-byte gate: artifact shape vs spec-transcribed events.ts.
    const baseline = SPEC_BASELINE[`${artifact}.${name}`];
    if (baseline && normalize(frag as Required<AbiEventItem>) !== baseline) {
      console.error(
        `[codegen-abi] ${artifact}.${name} DIVERGES from the spec-transcribed canonical ` +
          `fragment in packages/shared/src/abi/events.ts (byte-for-byte).\n` +
          `  artifact: ${normalize(frag as Required<AbiEventItem>)}\n` +
          `  spec:     ${baseline}\n` +
          `This is a cross-service contract change — escalate to robbed-architect ` +
          `(indexer.md / OI-1); do NOT patch the codegen or events.ts around it.`,
      );
      process.exit(1);
    }
    fragments.push(frag);
  }
  eventsByContract[artifact] = fragments;
}

// Plan-item verification hooks (M1-3) the two
// fields the indexer contract specifically hinges on must be present.
const hasInput = (artifact: string, ev: string, input: string) =>
  eventsByContract[artifact]
    ?.find((e) => e.name === ev)
    ?.inputs?.some((i) => i.name === input) === true;
if (!hasInput("CurveFactory", "TokenCreated", "metadataUri")) {
  console.error("[codegen-abi] TokenCreated is missing metadataUri () — refusing to emit");
  process.exit(1);
}
if (!hasInput("BondingCurve", "Trade", "trader")) {
  console.error("[codegen-abi] Trade is missing trader () — refusing to emit");
  process.exit(1);
}

const eventsJsonPath = join(repoRoot, "packages", "shared", "events.json");
writeFileSync(
  eventsJsonPath,
  `${JSON.stringify(
    {
      $generatedBy:
        "contracts/script/codegen-abi.ts — DO NOT EDIT. Canonical event ABI fragments " +
        "extracted from forge artifacts (contracts/out/<C>.sol/<C>.json) and cross-checked " +
        "byte-for-byte against packages/shared/src/abi/events.ts (; " +
        "contracts.md, leg 1). Regenerate: bun contracts/script/codegen-abi.ts",
      contracts: eventsByContract,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `[codegen-abi] wrote ${CONTRACTS.length} ABI JSON files + index.ts → ${abiDir}`,
);
console.log(`[codegen-abi] wrote canonical event fragments → ${eventsJsonPath}`);
