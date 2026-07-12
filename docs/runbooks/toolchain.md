# Contracts toolchain — install + pin record

Transcribes: `docs/how-it-works/contracts.md` §6 (gate 1 — static analysis) and §7.1 (deployment/verification toolchain).
Owner: `hoodpad-contracts`. Scope: everything under `contracts/`.

This file is the authoritative record of the static-analysis / build toolchain for the Foundry
workspace: exact versions, the install command used for each, and how solc `0.8.35` is resolved.
Re-run the verify block at the bottom after any toolchain change and update the versions here.

Recorded: 2026-07-10. Platform: darwin (arm64), macOS. Node v22.22.0 (nvm), Python 3.14.2 (Homebrew).

## Compiler pin

- **solc pin: `0.8.35`** (`0.8.35+commit.47b9dedd`). Set in `contracts/foundry.toml` as `solc = "0.8.35"`
  and required in every `pragma solidity 0.8.35;` (no `^`, no ranges — spec §6.7 / CLAUDE.md hard rule).
- **Blockscout confirmation:** `0.8.35+commit.47b9dedd` is present in the robinhoodchain.blockscout.com
  verifier config (`/api/v2/smart-contracts/verification/config`), checked 2026-07-09 (see foundry.toml header).
  Reviewer reported Blockscout verification failures on `0.8.36` for this chain, so the pin stays at `0.8.35`.
  A change to the pin is a §12 decision (hoodpad-architect), never silent.
- **Not this item:** the throwaway/canary-contract verification GUID is master-plan item **M1-2**, not P0-5.
  Only the pin value is recorded here.

## Installed tools

| Tool | Version | Binary on PATH | Install method |
|------|---------|----------------|----------------|
| Foundry (`forge`/`cast`/`anvil`/`chisel`) | 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, build 2026-05-08) | `~/.foundry/bin/forge` | `foundryup` (pre-existing) |
| Slither | 0.11.5 | `~/.local/bin/slither` → `~/.venvs/slither/bin/slither` | isolated venv (see below) |
| solc-select | 1.2.0 | `~/.local/bin/solc-select` → `~/.venvs/slither/bin/solc-select` | isolated venv (see below) |
| solc (standalone) | 0.8.35+commit.47b9dedd | `~/.local/bin/solc` → `~/.venvs/slither/bin/solc` (managed by solc-select) | `solc-select install 0.8.35` |
| solhint | 6.2.3 | `~/.nvm/.../bin/solhint` | `npm install -g solhint` |
| Aderyn | 0.6.8 | `~/.nvm/.../bin/aderyn` | `npm install -g @cyfrin/aderyn` |

### Install commands (exact, as run 2026-07-10)

Foundry — already present; managed by `foundryup`. Not reinstalled.

```sh
# Slither + solc-select — isolated venv (Homebrew Python is PEP 668 externally-managed;
# no pipx available, so a dedicated venv keeps these off the system interpreter).
python3 -m venv ~/.venvs/slither
~/.venvs/slither/bin/pip install --upgrade pip
~/.venvs/slither/bin/pip install slither-analyzer solc-select
# expose console scripts on PATH (~/.local/bin is already on PATH):
ln -sf ~/.venvs/slither/bin/slither     ~/.local/bin/slither
ln -sf ~/.venvs/slither/bin/solc-select ~/.local/bin/solc-select
ln -sf ~/.venvs/slither/bin/solc        ~/.local/bin/solc

# solhint — global npm (docs-confirmed canonical method, protofire/solhint)
npm install -g solhint

# Aderyn — global npm (Cyfrin/aderyn documents npm as a supported path)
npm install -g @cyfrin/aderyn
```

Rationale for the venv (Slither/solc-select): the system interpreter is Homebrew Python 3.14, which
is PEP 668 "externally managed" — a plain `pip3 install slither-analyzer` is refused, and `pipx` is
not available in this environment. A dedicated venv is the safest isolated install; symlinking only
the console scripts into `~/.local/bin` (already on PATH, no shell-profile edit) makes `slither`,
`solc-select`, and `solc` resolve globally without polluting the Homebrew interpreter. Do NOT run
`pip install --break-system-packages` against the Homebrew Python.

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

Requires `~/.foundry/bin` and `~/.local/bin` on PATH (both are on the interactive-shell PATH).

```sh
forge --version && slither --version && solhint --version && test -f docs/runbooks/toolchain.md
```

Expected: `forge` 1.7.1, `slither` 0.11.5, `solhint` 6.2.3, file present; overall exit 0.
Aderyn is not in the DoD gate but is installed and recorded: `aderyn --version` => `aderyn 0.6.8`.
