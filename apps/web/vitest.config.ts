import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest config (docs: vitest.dev/guide, verified 2026-07-10).
 *
 * Runner choice (decision, robbed-frontend): Vitest — NOT Bun's native test
 * runner — because the React component suites (.test.tsx) need jsdom + Testing
 * Library + the Vite/JSX transform, which `bun test` does not provide. `bun run
 * test` invokes `vitest run`, keeping Bun the entrypoint (CLAUDE.md) while Vitest
 * does the transform. Node env by default; .test.tsx files opt into jsdom.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    // Seed the NEXT_PUBLIC_* env the plumbing modules read at import time so
    // lib/chain.ts et al. don't throw during unit tests.
    env: {
      NEXT_PUBLIC_RPC_HTTP: "https://rpc.test.invalid",
      NEXT_PUBLIC_API_BASE_URL: "https://api.test.invalid",
      NEXT_PUBLIC_WS_URL: "wss://ws.test.invalid/v1/ws",
    },
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
