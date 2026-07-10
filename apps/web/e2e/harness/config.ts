/**
 * ── E2E harness config (plan I-5a) ───────────────────────────────────────────
 * Endpoints + anvil dev accounts for the Playwright suite. Everything is env-
 * driven so the same specs run against either the `docker compose up` stack
 * (host ports 4000/4001/4002/4545) or a hand-rolled stack on the task-stated
 * default ports (3000/3001/3002/8545). The config NEVER spawns the stack — it
 * only points at a running one (I-5a rule).
 *
 * This file lives under `apps/web/e2e/**`, which the M3-9 copy-lint `walk()`
 * explicitly skips, so the well-known public anvil dev keys/addresses here do
 * NOT trip the §2 address-literal grep. They are anvil's deterministic dev
 * accounts (Foundry docs), funded + unlocked on the fork — not secrets.
 */

// Defaults target the live docker stack's remapped 4xxx host ports (coordinator,
// 2026-07-09). `E2E_BASE_URL` is an accepted alias for `E2E_WEB_URL`. Point
// `E2E_WEB_URL` at a dedicated e2e web instance (NEXT_PUBLIC_E2E=true) when the
// docker `web` container has no mock connector baked in.
export const STACK = {
  webUrl: process.env.E2E_WEB_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:4000",
  apiUrl: process.env.E2E_API_URL ?? "http://localhost:4001",
  wsUrl: process.env.E2E_WS_URL ?? "ws://localhost:4002",
  rpcUrl: process.env.E2E_RPC_URL ?? "http://localhost:4545",
} as const;

/** Foundry/anvil deterministic dev accounts (public — the mnemonic is well-known). */
export interface DevAccount {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

const ANVIL_ACCOUNTS: DevAccount[] = [
  {
    // account #0 — deployer in docker-compose deploychain
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  {
    // account #1 — the local TREASURY stand-in (tools/localstack/out/local.env)
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  {
    // account #2 — TRADER
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
  {
    // account #3 — TRADER 2 (wallet-switch scenarios)
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  },
];

/**
 * Role → account map. The mock connector list `NEXT_PUBLIC_E2E_ACCOUNTS` MUST be
 * seeded in this exact order so `window.__ROBBED_E2E__.connect(i)` selects the
 * intended signer: 0=creator, 1=treasury, 2=trader, 3=trader2.
 */
export const ROLES = {
  creator: ANVIL_ACCOUNTS[0]!,
  treasury: ANVIL_ACCOUNTS[1]!,
  trader: ANVIL_ACCOUNTS[2]!,
  trader2: ANVIL_ACCOUNTS[3]!,
} as const;

/** Connector index in the wagmi e2e config, matching NEXT_PUBLIC_E2E_ACCOUNTS. */
export const ROLE_INDEX = {
  creator: 0,
  treasury: 1,
  trader: 2,
  trader2: 3,
} as const;

export const ALL_ACCOUNTS = ANVIL_ACCOUNTS;

/** Comma-joined address list for `NEXT_PUBLIC_E2E_ACCOUNTS` (web server env). */
export const E2E_ACCOUNTS_ENV = ANVIL_ACCOUNTS.map((a) => a.address).join(",");
