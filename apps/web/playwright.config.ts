import { defineConfig, devices } from "@playwright/test";

import { STACK } from "./e2e/harness/config";

/**
 * ── Playwright config (plan I-5a) ────────────────────────────────────────────
 * Docs-first (playwright.dev/docs/test-configuration, verified 2026-07-10).
 *
 * This config POINTS AT a running stack — it never spawns one (no `webServer`
 * block, by design: the full ROBBED_ stack is docker/compose-managed, I-2). The
 * web app must be served with `NEXT_PUBLIC_E2E=true` and `NEXT_PUBLIC_E2E_
 * ACCOUNTS=<anvil addrs>` so the anvil-backed mock connector + `window.
 * __ROBBED_E2E__` bridge replace the real wallet connectors (see e2e/README.md).
 *
 * Endpoints come from `E2E_*` env (harness/config.ts) — defaults target the
 * task-stated ports (web 3000 / api 3001 / anvil 8545 / ws 3002); the docker
 * stack maps 4000/4001/4545/4002, so set `E2E_WEB_URL` et al. for compose.
 *
 * `workers: 1` — the specs seed and mutate ONE shared anvil fork; serialising
 * keeps fork state (reserves, graduation, hostile-treasury) deterministic. The
 * static `e2e:coverage` gate runs independently and needs no stack.
 */
export default defineConfig({
  testDir: "./e2e/flows",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Indexed-layer assertions poll the indexer (waitForIndexed, up to 30s).
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "e2e/.report/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: STACK.webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
