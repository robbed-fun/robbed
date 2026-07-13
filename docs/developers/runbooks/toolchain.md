# Contracts toolchain — install + pin record

Transcribes: `docs/developers/contracts.md` §6 (gate 1 — static analysis) and §7.1 (deployment/verification toolchain).
Owner: `hoodpad-contracts`. Scope: everything under `contracts/`.

This file is the authoritative record of the static-analysis / build toolchain for the Foundry
workspace: exact versions, the install command used for each, and how solc `0.8.35` is resolved.
Re-run the verify block at the bottom after any toolchain change and update the versions here.

Recorded: 2026-07-10. Platform: darwin (arm64), macOS. Node v22.22.0 (nvm), Python 3.14.2 (Homebrew).
**Re-recorded: 2026-07-12 (user-approved reinstall).** Platform moved to **linux (x86_64)**; the darwin-era
`~/.foundry/bin` / `~/.venvs` layout did not exist on this machine, so the full toolchain was reinstalled
at the same pins (no version drift — all five tools verify at the exact 2026-07-10 versions, forge at the
same commit `4072e48705…`, solc at the same commit `47b9dedd`). Node v22.22.0 (nvm), Python 3.12.3 (system),
pipx 1.4.3 (`/usr/bin/pipx`).

## Compiler pin

- **solc pin: `0.8.35`** (`0.8.35+commit.47b9dedd`). Set in `contracts/foundry.toml` as `solc = "0.8.35"`
  and required in every `pragma solidity 0.8.35;` (no `^`, no ranges — spec §6.7 / CLAUDE.md hard rule).
- **Blockscout confirmation:** `0.8.35+commit.47b9dedd` is present in the robinhoodchain.blockscout.com
  verifier config (`/api/v2/smart-contracts/verification/config`), checked 2026-07-09 (see foundry.toml header).
  Reviewer reported Blockscout verification failures on `0.8.36` for this chain, so the pin stays at `0.8.35`.
  A change to the pin is a §12 decision (hoodpad-architect), never silent.
- **Not this item:** the throwaway/canary-contract verification GUID is master-plan item **M1-2**, not P0-5.
  Only the pin value is recorded here — the M1-2/O-5 round-trip record lives in the dedicated section at
  the bottom of this file ("O-5 / M1-2 — verification round-trip record").

## Installed tools

| Tool | Version | Binary on PATH (linux, 2026-07-12) | Install method |
|------|---------|----------------|----------------|
| Foundry (`forge`/`cast`/`anvil`/`chisel`) | 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, build 2026-05-08) | `~/.foundry/bin/forge` → `~/.foundry/versions/foundry-rs/foundry/v1.7.1/forge` (same for cast/anvil/chisel) | `curl -L https://getfoundry.sh/install \| bash`, then `foundryup --install 1.7.1` (see activation note below) |
| Slither | 0.11.5 | `~/.local/bin/slither` → `~/.local/share/pipx/venvs/slither-analyzer/bin/slither` | `pipx install slither-analyzer==0.11.5` |
| solc-select | 1.2.0 | `~/.local/bin/solc-select` → `~/.local/share/pipx/venvs/solc-select/bin/solc-select` | `pipx install solc-select` |
| solc (standalone) | 0.8.35+commit.47b9dedd | `~/.local/bin/solc` → `~/.local/share/pipx/venvs/solc-select/bin/solc` (managed by solc-select) | `solc-select install 0.8.35 && solc-select use 0.8.35` |
| solhint | 6.2.3 | `~/.nvm/versions/node/v22.22.0/bin/solhint` | `npm install -g solhint@6.2.3` |
| Aderyn | 0.6.8 | `~/.nvm/versions/node/v22.22.0/bin/aderyn` | `npm install -g @cyfrin/aderyn@0.6.8` |

### Install commands (exact, as run 2026-07-12 on linux x86_64)

```sh
# Foundry — foundryup installer, then the pinned version
# (docs-confirmed: https://getfoundry.sh/introduction/installation/ — `foundryup --install <version>`)
curl -L https://getfoundry.sh/install | bash
~/.foundry/bin/foundryup --install 1.7.1
# PATH: the init script does not edit the profile; appended to ~/.bashrc:
#   export PATH="$PATH:$HOME/.foundry/bin"

# Slither + solc-select — pipx (available on this machine at /usr/bin/pipx; isolated venvs
# under ~/.local/share/pipx/venvs, shims in ~/.local/bin which is already on PATH).
pipx install slither-analyzer==0.11.5
pipx install solc-select
solc-select install 0.8.35
solc-select use 0.8.35        # writes ~/.solc-select/global-version

# solhint / Aderyn — global npm, exact versions (docs-confirmed canonical methods)
npm install -g solhint@6.2.3
npm install -g @cyfrin/aderyn@0.6.8
```

**foundryup activation note (2026-07-12):** `foundryup --install 1.7.1` downloaded and
attestation-verified the v1.7.1 binaries into `~/.foundry/versions/foundry-rs/foundry/v1.7.1/`
but refused the final activation step with "'anvil' is currently running" — a false positive on
the *containerized* anvil of the local dev stack (`robbed-anvil-1`, exe `/usr/local/bin/anvil`
inside the container's own mount namespace; host symlinks cannot affect it). Activation was done
manually with the same layout foundryup creates:
`ln -sf ~/.foundry/versions/foundry-rs/foundry/v1.7.1/{forge,cast,anvil,chisel} ~/.foundry/bin/`.
`foundryup --list` recognizes the install. If reinstalling with the dev stack down, plain
`foundryup --install 1.7.1` completes on its own.

Rationale for pipx (Slither/solc-select): the 2026-07-10 darwin install used a hand-rolled venv
because pipx was unavailable there; on this linux machine pipx 1.4.3 is present, and pipx is the
standard isolated-CLI install (equivalent to crytic's recommended `uv tool install` model). The
system interpreter (Python 3.12.3) stays untouched. The old `~/.venvs/slither` layout is retired.

Rationale for global npm (solhint/Aderyn): per §12.29 the workspace lockfile/`package.json` is
pnpm and owned by `hoodpad-shared`; contracts tooling must not become a repo devDependency edited
here. Global installs keep a working `--version` on PATH without touching `package.json` /
`pnpm-lock.yaml` / `pnpm-workspace.yaml`. If CI later needs these pinned as repo deps, that is a
hoodpad-shared change, not a contracts change.

## How solc `0.8.35` is resolved for Slither

Slither does not compile Solidity itself — it delegates via crytic-compile. Two resolution paths,
both landing on `0.8.35`:

1. **Foundry-project analysis (the CI/gate-1 path).** Run from `contracts/`, Slither invokes
   `forge build`, which honours `solc = "0.8.35"` in `foundry.toml`; Foundry auto-fetches/uses that
   exact compiler and Slither reads the resulting build artifacts. The pin is single-sourced from
   `foundry.toml` — nothing else to configure.
2. **Standalone / single-file analysis.** When no framework is detected, crytic-compile shells out
   to `solc` on PATH. `solc-select` pins that to `0.8.35` globally
   (`~/.solc-select/global-version` → `0.8.35`, set by `solc-select use 0.8.35`), so ad-hoc
   `slither path/to/File.sol` also compiles on `0.8.35+commit.47b9dedd`.

To (re)establish the standalone pin on a fresh machine:

```sh
solc-select install 0.8.35
solc-select use 0.8.35        # writes ~/.solc-select/global-version
solc --version                # => 0.8.35+commit.47b9dedd
```

Solhint enforces the pin independently at lint time via the `compiler-version` rule set to
`0.8.35` in `contracts/.solhint.json` (belt-and-suspenders against a stray pragma).

## Verify (P0-5 definition of done)

Requires `~/.foundry/bin` and `~/.local/bin` on PATH (both are on the interactive-shell PATH;
`~/.foundry/bin` added to `~/.bashrc` 2026-07-12).

```sh
forge --version && slither --version && solhint --version && test -f docs/runbooks/toolchain.md
```

Expected: `forge` 1.7.1, `slither` 0.11.5, `solhint` 6.2.3, file present; overall exit 0.
Aderyn is not in the DoD gate but is installed and recorded: `aderyn --version` => `aderyn 0.6.8`.
Last run green: 2026-07-12 (linux reinstall) — forge 1.7.1, slither 0.11.5, solhint 6.2.3,
aderyn 0.6.8, `solc-select versions` => `0.8.35 (current)`.

## O-5 / M1-2 — verification round-trip record

**TESTNET round-trip: DONE 2026-07-12** (Phase-T, per docs/runbooks/testnet.md §6 + this file's pin).
A throwaway probe contract (`VerifyProbe085Cancun`, MIT, no constructor args, exercises the
Cancun-only `mcopy` path) was compiled at the EXACT production pins — solc `0.8.35+commit.47b9dedd`,
`evm_version = cancun`, optimizer on / 200 runs — deployed to Robinhood Chain **testnet (46630)** and
verified on the testnet Blockscout with `forge verify-contract … --verifier blockscout
--verifier-url https://explorer.testnet.chain.robinhood.com/api --chain-id 46630 --watch`
(Blockscout v2 verifier, no API key — spec §12.52):

| Field | Value |
|---|---|
| Date | 2026-07-12 |
| Contract | `VerifyProbe085Cancun` (throwaway probe — not part of `contracts/src`) |
| Address (46630) | `0x8584Be043292ED7c688F193AbdC4271A0B9a0892` |
| Deploy tx | `0xbcbf6754deb85b9fe5855f21f4c788997f6c00a06ec8555bf653da47d9ae39de` |
| Verification GUID | `8584be043292ed7c688f193abdc4271a0b9a08926a5378b7` |
| Result | `Pass - Verified`; API read-back: `is_verified: true`, `compiler_version: v0.8.35+commit.47b9dedd`, `evm_version: cancun`, `optimization_runs: 200` |
| Explorer | https://explorer.testnet.chain.robinhood.com/address/0x8584be043292ed7c688f193abdc4271a0b9a0892 |

Notes: (a) Blockscout's API reports `license_type: "none"` — forge's Blockscout submission does not
carry a license field; the verified SOURCE carries the `SPDX-License-Identifier: MIT` header, which is
the spec §6.7 requirement. (b) This round-trip proves the **testnet** verifier
(explorer.testnet.chain.robinhood.com); the **mainnet** robinhoodchain.blockscout.com round-trip
(the original O-5 target — pin presence in its config was confirmed 2026-07-09, see "Compiler pin")
is repeated at the first mainnet deploy before anything else is broadcast there.
