---
name: verify-contract
description: >-
  Runbook-skill for publishing/verifying a deployed contract on the Robinhood Chain TESTNET (chain
  46630) Blockscout explorer. Use when the user says "verify contract", "publish contract", "verify on
  blockscout", "verify testnet contract", "verify 46630", "contract not verified on the explorer", or
  "the Code tab is empty / shows Fail - Unable to verify". Covers all three modes — inline `--verify`
  at deploy, after-the-fact `--guess-constructor-args` for simple ctors, and explicit
  `--constructor-args 0x…` for complex ctors (CurveFactory's 20-field FactoryInit) and factory-created
  instances (a graduated token's LaunchToken/BondingCurve, the deploy canary). Blockscout v2 verifier,
  NO API key. Idempotent — safe to re-run.
---

# Verify & publish a contract on Robinhood Chain testnet (46630) Blockscout

Authoritative source order: the design docs win. This skill is derived from
`docs/developers/contracts.md` "Deployment & verification" (the `0.8.35` + `cancun` + MIT pin, and
"verify all six contracts + the canary token/curve on Blockscout") and the testnet endpoints +
verifier ratification in `docs/developers/runbooks/testnet.md` and `docs/developers/design-decisions.md`
(D-52: the testnet explorer runs the **Blockscout v2 verifier, no API key required**, with
`solc v0.8.35+commit.47b9dedd` in its supported list). If this skill and a design doc disagree, the doc
wins and the drift is reported. **Run every command from `contracts/`.** Verification is **read-only**:
it needs NO private key — the only env vars are the public `TESTNET_RPC_URL` and
`TESTNET_BLOCKSCOUT_URL`.

This is the shared verification runbook. The `/testnet-redeploy` skill's Step 2 points here for the
mechanics; keep the two in sync.

## Docs-first rule (mandatory, every run)

Before touching any flag, consult current official docs for the tools in play — never work from memory.
Primary channel: **context7 MCP** (`resolve-library-id` → `get-library-docs`); fallback WebFetch of the
canonical page. Docs beat assumptions; the design docs beat library docs (flag any conflict).

- Foundry `forge verify-contract` / `forge script --verify` — https://getfoundry.sh/forge/reference/forge-verify-contract/ (and the deploying guide)
- Blockscout Foundry verification (verifier type, `/api` URL, API-key-optional) — https://docs.blockscout.com/devs/verification/foundry-verification
- Robinhood Chain testnet params (RPC, explorer, faucet) — https://docs.robinhood.com/chain/connecting
- Arbitrum Orbit gas model (only relevant to the deploy leg, not verify) — https://docs.arbitrum.io

**Doc basis for the flags below (verified this session):** the Blockscout docs specify
`--verifier blockscout` + `--verifier-url <explorer>/api` and state the API key is **optional**; the
Foundry reference defines `--guess-constructor-args` ("extract constructor arguments from on-chain
creation code"), `--constructor-args` (ABI-encoded args), and `--watch` (poll until the result). Note:
the Foundry reference tags `--constructor-args` as "Only for Etherscan", but Blockscout implements the
Etherscan-compatible verification API, so `--constructor-args` **does** work against
`--verifier blockscout` (proven live this session on CurveFactory).

## Invariants this skill will not violate

- **Exact compiler match or it fails closed.** The deployed bytecode was built with solc `0.8.35`
  (`v0.8.35+commit.47b9dedd`), `evm_version = cancun`, the repo's fixed optimizer runs, MIT
  (`docs/developers/contracts.md` "Toolchain"; D-9/D-44). Verification recompiles from source and must
  match byte-for-byte — a mismatched pin/optimizer/evm-version yields **"Fail - Unable to verify"**.
  Never pass a different `--compiler-version` / `--evm-version` to "make it pass": fix the source or the
  pin, never the verify flags.
- **No API key.** The testnet Blockscout is a **v2 verifier, key-less** (D-52). Never invent or paste an
  API key; never add `--verifier-api-key`.
- **Testnet-only endpoints.** This runbook targets **46630** (`explorer.testnet.chain.robinhood.com`).
  Mainnet **4663** verifies against `robinhoodchain.blockscout.com/api` and is a **separate** owed
  round-trip (`docs/developers/contracts.md` step 8; the redeploy skill's B4 item) — never reuse the
  testnet URL on a 4663 address.
- **No hardcoded market metrics** (always-on `no-market-metrics` rule): nothing here inlines a
  price/TVL/threshold. The addresses below are real 46630 deploy artifacts, not metrics.
- **Never read the real root `.env`.** Verify needs no secret. Reference `TESTNET_RPC_URL` /
  `TESTNET_BLOCKSCOUT_URL` by NAME; both are public.

## Endpoints (46630)

| Var | Value |
|---|---|
| `TESTNET_RPC_URL` | `https://rpc.testnet.chain.robinhood.com` (public, non-archive) |
| `TESTNET_BLOCKSCOUT_URL` | `https://explorer.testnet.chain.robinhood.com` |
| **Verifier URL** | `$TESTNET_BLOCKSCOUT_URL/api` (explorer homepage + `/api`) |
| Chain id | `46630` |

```bash
cast chain-id --rpc-url "$TESTNET_RPC_URL"   # MUST print 46630 before you verify against it
```

---

## Mode 1 — Inline at deploy (preferred)

Fold verification into the broadcast so each contract is verified **as it lands**, with constructor
args recovered automatically. This is what `/testnet-redeploy` Step 1 does; add these three flags to the
`forge script … --broadcast` (keep that skill's mandatory Orbit gas flags — they belong to the deploy,
not the verify):

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url "$TESTNET_RPC_URL" --broadcast \
  --verify --verifier blockscout \
  --verifier-url "$TESTNET_BLOCKSCOUT_URL/api"
```

Inline verify handles most contracts. When a constructor is too complex for the inline path
(CurveFactory), or the target is a factory-created instance (no top-level creation tx), fall through to
Mode 2/3 after the deploy.

---

## Mode 2 — After the fact, simple constructors (`--guess-constructor-args`)

Works whenever Foundry can recover the ctor args from the contract's creation transaction. Used this
session for **Router, V3Migrator, LPFeeVault, CreatorVault** — all verified via `--guess`.

```bash
cd contracts
forge verify-contract <ADDR> src/Router.sol:Router \
  --verifier blockscout \
  --verifier-url "$TESTNET_BLOCKSCOUT_URL/api" \
  --chain-id 46630 \
  --rpc-url "$TESTNET_RPC_URL" \
  --guess-constructor-args --watch
```

The `<path>:<Name>` positional must resolve to the exact source unit that was deployed.
`--watch` polls to `Pass - Verified` / `Fail`. If it prints **"Fail - Unable to verify"**, first suspect
a pin/optimizer/evm-version mismatch (see the invariant), not the ctor args.

---

## Mode 3 — Complex constructor args (explicit `--constructor-args 0x…`)

When `--guess` fails — e.g. CurveFactory's **20-field `FactoryInit` struct** — pass the ABI-encoded
args explicitly. The robust way to GET the hex is to derive it from the broadcast + the compiled
init-bytecode, so you never hand-encode 20 fields:

```bash
cd contracts

# 1) the CREATE tx's input for this contract (init-bytecode ++ abi-encoded ctor args)
INPUT=$(jq -r '.transactions[]
  | select(.transactionType=="CREATE" and .contractName=="CurveFactory")
  | (.transaction.input // .transaction.data)' \
  broadcast/Deploy.s.sol/46630/run-latest.json)

# 2) the compiled creation (init) bytecode — the exact prefix of INPUT
INIT=$(jq -r '.bytecode.object' out/CurveFactory.sol/CurveFactory.json)

# 3) strip the init-bytecode prefix; the remainder IS the ABI-encoded ctor args
ARGS="0x${INPUT#"$INIT"}"

# 4) verify with the explicit args
forge verify-contract 0xC5cD74C1859f36348419AF93B0a07D1d9a3b51A5 \
  src/CurveFactory.sol:CurveFactory \
  --verifier blockscout \
  --verifier-url "$TESTNET_BLOCKSCOUT_URL/api" \
  --chain-id 46630 \
  --rpc-url "$TESTNET_RPC_URL" \
  --constructor-args "$ARGS" --watch
```

Notes:
- The strip in step 3 is only valid when `out/` was produced by the **same compile that deployed**
  (same commit, same `foundry.toml` pin). A dirty rebuild changes `.bytecode.object` and the strip
  yields garbage — rebuild at the deployed commit first (or re-derive constants and recompile).
- `${INPUT#"$INIT"}` removes the leading init prefix (both strings carry a `0x`; the result drops it, so
  step 3 re-prepends `0x`). Sanity-check `ARGS` looks like a clean multiple-of-32-byte tail.
- Alternative when you already hold the raw values: `--constructor-args "$(cast abi-encode \
  "constructor(...)" val1 val2 …)"`. The strip recipe is preferred for CurveFactory precisely because
  hand-writing the 20-field signature is error-prone.

### Factory-created instances (LaunchToken / BondingCurve / the deploy canary)

A graduated token's `LaunchToken` and its `BondingCurve`, and the in-script deploy canary, are created
by the factory via an internal CREATE — they have **no top-level creation tx**, so `--guess` can't read
their args and they are not CREATE rows in `run-latest.json`. Verify them with the Mode 3 technique but
source the ctor args from the **factory**, not the broadcast: read the params from the `TokenCreated`
event (`name`, `symbol`, `metadataHash`, `creator`, …) and the factory `config()` (curve constants),
`cast abi-encode` them against the LaunchToken/BondingCurve constructor signature, and pass via
`--constructor-args`. Then confirm the Code tab (below).

---

## Confirm published

`--watch` ends in `Pass - Verified`, but always eyeball the explorer: the address page's
**Contract → Code** tab must show the green-checked source + ABI and the matched compiler settings:

```
https://explorer.testnet.chain.robinhood.com/address/<ADDR>#code
```

Green check + visible source/ABI + `solc v0.8.35+commit.47b9dedd` / `cancun` / MIT == published.

---

## Worked example — this session's testnet deploy (46630)

| Contract | Address | How verified |
|---|---|---|
| CurveFactory | `0xC5cD74C1859f36348419AF93B0a07D1d9a3b51A5` | **Mode 3** — explicit `--constructor-args` (20-field `FactoryInit`; `--guess` failed) |
| Router | `0x05A5dC…` | Mode 2 — `--guess-constructor-args` |
| V3Migrator | `0xA07394…` | Mode 2 — `--guess-constructor-args` |
| LPFeeVault | `0xeCeBD1…` | Mode 2 — `--guess-constructor-args` |
| CreatorVault | `0xdF305a…` | Mode 2 — `--guess-constructor-args` |

All five verified this session. The canonical **full** addresses live in
`contracts/deployments/46630.json` (never transcribe truncated forms into a command — read them from the
artifact). The canary `LaunchToken` + `BondingCurve` follow the factory-created-instance path above.

---

## Definition of done

- [ ] `cast chain-id --rpc-url "$TESTNET_RPC_URL"` == `46630` (right chain).
- [ ] Every intended contract shows `Pass - Verified` (from `--watch`) AND a green Code tab at
      `…/address/<ADDR>#code`.
- [ ] Compiler settings on the Code tab read `solc v0.8.35+commit.47b9dedd`, `cancun`, MIT — matching
      the deploy pin (no flag was bent to force a pass).
- [ ] No API key was used; no private key was touched.
- [ ] For a full deploy: all six contracts + the canary LaunchToken/BondingCurve verified (the
      M1-2/O-5 testnet-verifier pin check; mainnet 4663 round-trip is the separate B4 item).

## Idempotency notes

- **Safe to re-run any time.** `forge verify-contract` is idempotent — verifying an already-verified
  address is a no-op ("already verified"). Re-run freely after a flaky RPC/verifier hiccup.
- **The only non-idempotent thing near here is the deploy** (`forge script --broadcast`, Mode 1) — that
  mints new addresses and is the `/testnet-redeploy` skill's job, not this one.
- If verify keeps failing: (1) pin/optimizer/evm mismatch — rebuild at the deployed commit; (2) wrong
  `<path>:<Name>` unit; (3) for complex ctors, a dirty `out/` broke the Mode 3 strip; (4) you pointed at
  the mainnet verifier URL for a 46630 address (or vice-versa).
