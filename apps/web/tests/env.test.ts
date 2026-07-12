import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "@/shared/lib/env";

/**
 * Split-horizon API base resolution — `env.apiFetchBaseUrl()` (web.md §2.3;
 * 2026-07-12 fix: SSR fetches inside the compose stack must use the
 * compose-internal origin, browsers the public one).
 *
 * Resolution order under test:
 *   1. window undefined (server) + `API_BASE_URL_INTERNAL` set → internal;
 *   2. window defined (browser) → public, even if internal is set;
 *   3. internal unset/empty → public (host-run dev + prod unchanged).
 *
 * This file runs in vitest's default `node` environment (vitest.config.ts:
 * only `.test.tsx` opts into jsdom), so `window` is GENUINELY undefined — the
 * server horizon is real, not mocked. The browser horizon is simulated with
 * `vi.stubGlobal("window", …)`. The public base comes from the seeded
 * `NEXT_PUBLIC_API_BASE_URL` in vitest.config.ts `test.env`.
 */

// Must mirror vitest.config.ts test.env — the build-time-inlined public base.
const PUBLIC_BASE = "https://api.test.invalid";

describe("env.apiFetchBaseUrl — split-horizon resolution (web.md §2.3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("server horizon: window undefined + internal set → internal base", () => {
    // Premise: this suite really runs server-side (node env, no jsdom).
    expect(typeof window).toBe("undefined");
    vi.stubEnv("API_BASE_URL_INTERNAL", "http://api:3001");
    expect(env.apiFetchBaseUrl()).toBe("http://api:3001");
  });

  it("server horizon: strips a trailing slash from the internal base", () => {
    // Same normalization as apiBaseUrl() — paths compose to one `/v1/…` segment.
    vi.stubEnv("API_BASE_URL_INTERNAL", "http://api:3001/");
    expect(env.apiFetchBaseUrl()).toBe("http://api:3001");
  });

  it("browser horizon: window defined → public base, internal var ignored", () => {
    vi.stubEnv("API_BASE_URL_INTERNAL", "http://api:3001");
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    expect(env.apiFetchBaseUrl()).toBe(PUBLIC_BASE);
  });

  it("server horizon: internal unset → public base (host-run dev unchanged)", () => {
    // Force-unset so a value leaked from the developer shell cannot skew this.
    vi.stubEnv("API_BASE_URL_INTERNAL", undefined);
    expect(env.apiFetchBaseUrl()).toBe(PUBLIC_BASE);
  });

  it("server horizon: internal EMPTY string → public base (empty ≠ configured)", () => {
    vi.stubEnv("API_BASE_URL_INTERNAL", "");
    expect(env.apiFetchBaseUrl()).toBe(PUBLIC_BASE);
  });

  it("public accessor is untouched by the internal var (og:image stays public)", () => {
    // views/token-detail/model/metadata.ts builds the crawler-fetched og:image
    // URL from apiBaseUrl(); the internal override must never leak into it.
    vi.stubEnv("API_BASE_URL_INTERNAL", "http://api:3001");
    expect(env.apiBaseUrl()).toBe(PUBLIC_BASE);
  });
});
