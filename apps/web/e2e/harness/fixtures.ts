/**
 * ── Playwright fixtures (plan I-5a) ──────────────────────────────────────────
 * Extends the base test with a stack-readiness guard: every flow spec skips
 * (with a clear message) when the stack isn't reachable, so `bunx playwright
 * test` NEVER reports a false pass on an absent stack (RUN-OR-AUTHOR). When the
 * stack is up, the guard is a no-op and the flow runs for real.
 */
import { test as base, expect } from "@playwright/test";

import { STACK } from "./config";
import { stackStatus } from "./stack";

/**
 * The API ships NO `Access-Control-Allow-Origin` header (verified 2026-07-10), so
 * the browser app — cross-origin to the API (web :4000/:4100 vs api :4001) —
 * cannot read client-side REST responses (search, TanStack refetch). This is a
 * real product gap reported to robbed-indexer/architect: a cross-origin browser
 * app needs CORS (or a same-origin reverse proxy) on the API. Until it lands, the
 * harness injects permissive CORS on API responses so the e2e run exercises the
 * client exactly as a correctly-deployed (same-origin/CORS) stack would. Spec-
 * level routes that fulfill API responses (ERR-6a, ERR-12) add the same header.
 */
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,accept",
};

export const test = base.extend<{ stackReady: void }>({
  page: async ({ page }, use) => {
    // NOTE on clocks: the app computes tx deadlines from wall time
    // (`computeDeadline` = Date.now()+10m). Anvil warps push `block.timestamp`
    // AHEAD of wall time, but a UI-driven trade only expires once that drift
    // exceeds the 10-minute deadline; a full suite run drifts a few hundred
    // seconds (well under 600s), so wall-based deadlines stay valid and we do NOT
    // fake the page clock — `page.clock.install` breaks timer-driven UI (debounced
    // search, the WS-driven live tape, optimistic silence timers). Fork-relative
    // times that MUST track the chain (candle windows, a deliberately-past
    // deadline) are computed with `forkNowSeconds()`/`forkDeadline()` directly.
    await page.route(`${STACK.apiUrl}/**`, async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: CORS_HEADERS });
        return;
      }
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), ...CORS_HEADERS } });
    });
    await use(page);
  },
  stackReady: [
    async ({}, use, testInfo) => {
      const s = await stackStatus();
      testInfo.skip(
        !s.ready,
        `stack not reachable (web=${s.web} api=${s.api} anvil=${s.anvil}). ` +
          `Start it (docker compose up / manual) and set E2E_* endpoints. ` +
          `The e2e:coverage gate is static and does NOT require the stack.`,
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
