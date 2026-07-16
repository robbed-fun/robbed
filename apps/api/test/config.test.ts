import { describe, expect, it } from "bun:test";

import { loadConfig } from "../src/config";

function prodEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    API_ENV: "production",
    DATABASE_URL: "postgres://user:pass@db:5432/robbed",
    CORS_ALLOWED_ORIGINS: "https://robbed.fun",
    R2_PUBLIC_BASE_URL: "https://api.robbed.fun/v1/assets",
    ...overrides,
  };
}

describe("loadConfig asset base guard", () => {
  it("rejects localhost asset bases in production", () => {
    expect(() =>
      loadConfig(prodEnv({ R2_PUBLIC_BASE_URL: "http://localhost:9000/robbed-assets" })),
    ).toThrow(/R2_PUBLIC_BASE_URL must be a public/);
  });

  it("accepts the public API asset proxy in production", () => {
    const cfg = loadConfig(prodEnv());
    expect(cfg.R2_PUBLIC_BASE_URL).toBe("https://api.robbed.fun/v1/assets");
  });
});
