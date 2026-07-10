#!/usr/bin/env bun
/**
 * M1-3b — full read-function contract ABI codegen (spec §12.38; contracts.md
 * §7.4 leg 2; architecture.md §4).
 *
 * Compilation-time (NOT deploy-time) step: `forge build`, then extract the
 * complete `.abi` array (read + write functions, errors, events — everything,
 * not just event fragments) of each of the six robbed contracts from
 * `contracts/out/<C>.sol/<C>.json` and emit:
 *
 *   packages/shared/src/abi/<C>.json   — the raw ABI array (one per contract)
 *   packages/shared/src/abi/index.ts   — a typed barrel that inlines each ABI
 *                                        with `as const` so viem/wagmi infer
 *                                        literal types (JSON imports cannot —
 *                                        viem.sh/docs/typescript).
 *
 * Owned by the contracts pipeline (generated artifact); lives under
 * packages/shared per the anti-drift rule (single source; apps import, never
 * hand-write — architecture.md §4). Distinct from:
 *   - `events.ts` (M1-3): hand-authored canonical event fragments the contracts
 *     must MATCH byte-for-byte; contract-first source of truth, NOT regenerated
 *     here (regenerating would invert the direction of truth). Left untouched;
 *     re-exported from the barrel for a single import surface.
 *   - deploy-time `addresses` (M1-14): needs a broadcast; separate leg.
 *
 * Re-runnable:  bun contracts/script/codegen-abi.ts
 *
 * Verify (spec §12.38):
 *   forge build green; six ABI files exist;
 *   grep -q 'reserves' packages/shared/src/abi/BondingCurve.json
 *   grep -q '"config"' packages/shared/src/abi/CurveFactory.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The six robbed contracts whose full ABIs cross the service seam (§12.38). */
const CONTRACTS = [
  "LaunchToken",
  "CurveFactory",
  "BondingCurve",
  "Router",
  "V3Migrator",
  "LPFeeVault",
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

  // Raw ABI array — pretty-printed so the §12.38 greps match and diffs are readable.
  writeFileSync(join(abiDir, `${name}.json`), `${JSON.stringify(abi, null, 2)}\n`);
}

// ── 2b. Sanity-assert the reads the consumers actually depend on (§12.38) ────
// Fails the codegen loudly if an ABI drifts out from under the frontend Trust
// panel / indexer curve-constants read, rather than shipping a silent gap.
const REQUIRED_FNS: Partial<Record<ContractName, string[]>> = {
  BondingCurve: ["reserves", "phase", "quoteBuy", "quoteSell", "TRADE_FEE_BPS", "buy", "sell"],
  CurveFactory: ["config", "createToken"],
  LaunchToken: ["metadataHash", "totalSupply"],
  LPFeeVault: ["collect"],
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
// Full read+write ABIs for the six robbed contracts (spec §12.38, M1-3b).
// \`as const\` is mandatory: viem/wagmi infer literal types only from const
// ABIs, never from plain JSON imports (viem.sh/docs/typescript).
`;

const parts: string[] = [banner];

// Re-export the hand-authored canonical event fragments (M1-3) so `@robbed/shared/abi`
// remains a single import surface (events + full ABIs) after the export map is repointed.
parts.push(`export * from "./events";\n`);

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

console.log(
  `[codegen-abi] wrote ${CONTRACTS.length} ABI JSON files + index.ts → ${abiDir}`,
);
