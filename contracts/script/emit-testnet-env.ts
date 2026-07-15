#!/usr/bin/env bun
/**
 * Backwards-compatible wrapper for the old testnet-only command.
 * Prefer:
 *   bun contracts/script/emit-deployment-env.ts --network testnet
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "emit-deployment-env.ts");
const result = spawnSync("bun", [script, "--network", "testnet", ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
