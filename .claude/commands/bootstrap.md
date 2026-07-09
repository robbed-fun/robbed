---
description: Set up the hoodpad dev environment — Foundry + pinned solc, OZ v5, monorepo scaffold (contracts/, apps/, packages/), bun workspaces, root README. Idempotent; safe to re-run.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch
---

Bootstrap the hoodpad development environment per `launchpad-spec.md` §6 (contracts layout), §6.7 (compiler pin), §8 (off-chain layout) and `CLAUDE.md` (stack). **Idempotent**: before every step, check whether it's already done and skip if so — never clobber existing files, never re-init an existing workspace, never overwrite a file that has diverged (report the divergence instead). `$ARGUMENTS` may name a subset of steps (e.g. `foundry`, `monorepo`, `readme`); default is all steps in order.

Known starting toolchain: Bun 1.3.14 and Node 22 installed; Foundry, Slither, solhint, Ponder NOT installed.

## 1. Foundry toolchain (check-before-install)

- `command -v forge` — if present, report `forge --version` and skip install.
- Else install via foundryup: `curl -L https://foundry.paradigm.xyz | bash` then run `foundryup` (source the shell env it writes first, e.g. `~/.foundry/bin` on PATH). Verify with `forge --version`.

## 2. Compiler pin verification (§6.7 — do this BEFORE writing foundry.toml)

Candidate pin is `0.8.35`, but it **must be verified against Robinhood Blockscout**: reviewer reports 0.8.36 verification failures on this chain. Check https://robinhoodchain.blockscout.com verifier-supported solc versions (WebFetch the verifier config endpoint, e.g. `/api/v2/smart-contracts/verification/config`, and look for `0.8.35` in the supported list).
- Confirmed → use `0.8.35` and say so in the report.
- Cannot confirm (endpoint unreachable / version absent) → still scaffold with `0.8.35` but mark the pin **UNVERIFIED** in the report and in a `TODO(§13)` comment in `foundry.toml`; the pin is open item §13.
Never use a version range anywhere.

## 3. Foundry workspace under contracts/

If `contracts/foundry.toml` exists, skip init (but verify the pin inside it matches — report drift, don't silently rewrite). Else:
- `forge init contracts --no-git --no-commitments` (repo root already a git repo); delete the sample `Counter` src/test/script files.
- `foundry.toml`: `solc = "0.8.35"` (exact, no range), `optimizer = true` with explicit runs, `evm_version` left default unless Blockscout verification dictates otherwise, fmt config, and a `[rpc_endpoints]` entry `robinhood = "${ROBINHOOD_RPC_URL}"` for fork tests (§10 gate 3).
- Install OZ v5: `cd contracts && forge install OpenZeppelin/openzeppelin-contracts@v5.5.0` (pin an exact v5.x tag; if that tag 404s, use the latest v5 tag and report which) + remapping `@openzeppelin/=lib/openzeppelin-contracts/`.
- Create empty dirs per spec §6: `contracts/src/{interfaces,errors,libs}`, `contracts/test/{unit,fuzz,invariant,fork}`, `contracts/script` (with `.gitkeep`). Do NOT write any contract code — scaffolding only; contracts are hoodpad-contracts' job (M1).

## 4. Monorepo layout (bun workspaces)

Create only what's missing:
- Root `package.json` (if absent): `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, name `hoodpad`, license MIT.
- `apps/web`, `apps/indexer`, `apps/api`, `packages/shared` — for each that lacks a `package.json`, run `bun init -y` inside it (or write a minimal `package.json`: name `@hoodpad/web|indexer|api|shared`, `"private": true`, MIT), plus a stub `tsconfig.json` extending a root `tsconfig.base.json` (create the base if missing: strict, ESNext modules, bundler resolution). Note in each app's package.json description which spec section it implements (§9 web, §8 indexer, §8 api, shared types).
- Do NOT install Ponder/Next/Hono dependencies or scaffold app code — that belongs to M2/M3 and the specialized agents. Bootstrap stops at workspace skeleton.
- Root `.gitignore`: ensure entries for `node_modules`, `contracts/out`, `contracts/cache`, `.env*`, `!.env.example`. Do NOT ignore `contracts/lib/` — with `--no-git` installs the OZ dependency is vendored and must be committed for reproducible builds.
- `.env.example` (if absent): `ROBINHOOD_RPC_URL=`, `ROBINHOOD_WS_RPC_URL=`, `DATABASE_URL=`, `REDIS_URL=`, `R2_*=` placeholders — no secrets, no invented addresses.

## 5. Root README (if absent)

Short: what hoodpad is (one paragraph, soft-confirmed AMM launchpad on Robinhood Chain 4663 — no market-metric claims per §2), monorepo map (each dir → spec section), pointer to `launchpad-spec.md` as source of truth and `CLAUDE.md` for hard rules, milestone table from §11, MIT license note, and the repo-public/security-posture line from §10 (repo public day 1). Use the exact LP sentence if LP mechanics are mentioned: "LP principal permanently locked; trading fees claimable by treasury."

## 6. Verify + report

Run: `forge --version`, `bun --version`, `forge build` inside `contracts/` (must succeed on the pinned solc, even with empty src/), `bun install` at root. Report: each step done/skipped-already-present/failed, the compiler-pin verification outcome (confirmed vs UNVERIFIED→§13), exact versions installed, and any file that diverged from expected and was left untouched.
