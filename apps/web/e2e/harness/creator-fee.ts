/**
 * ── post-graduation creator-fee harness (§12.67 / §12.68 / §12.69) ───────────
 * Drivers + readers for the Phase-2 creator-fee factory generation (a FRESH
 * immutable generation: new CurveFactory + BondingCurve + Router + pull-payment
 * CreatorVault + creator-aware LPFeeVault). Used by the CFEE-* flows to:
 *   - generate REAL post-grad V3 pool fees (SwapRouter02 exactInputSingle, BOTH
 *     legs — a WETH-in buy accrues the WETH-leg fee, a token-in sell the token-leg);
 *   - drive the split `collect(tokenId)` and the CreatorVault `claim` (ETH-leg +
 *     token-leg), plus the pre-grad `sweepCreatorFees()` (§12.68 curve leg);
 *   - read the set-once `tokenId → creator` registration + the 50/50 immutable.
 *
 * ── ABI PROVENANCE (docs-first, 2026-07-13) ──────────────────────────────────
 * The ENTIRE surface ships in `@robbed/shared/abi` (codegen from the landed
 * Phase-2 contracts) and is imported here — NO ABI is hand-written (anti-drift):
 *   - `lpFeeVaultAbi` — split `collect` (returns `(amount0, amount1)`), the
 *     `FeesCollected(tokenId, amount0, amount1)` total + the §12.69(G)
 *     `FeesSplit(tokenId, creator, treasury0, creator0, treasury1, creator1)`
 *     per-leg split, set-once `creatorOf(tokenId)` / migrator-gated
 *     `registerCreator(tokenId, creator)` / `creatorLpShareBps()` (immutable 5000);
 *   - `creatorVaultAbi` — ETH-leg `balanceOf`/`claim`/`deposit` + token-leg
 *     `tokenBalanceOf(creator, token)` / `claimERC20(creator, token)`;
 *   - `bondingCurveAbi` — `sweepCreatorFees`/`accruedCreatorFees`/`CREATOR_FEE_BPS`;
 *   - `curveFactoryAbi.creatorVault`; external V3 addresses from `@robbed/shared`
 *     `UNISWAP_V3` / `WETH_ADDRESS` (§12.28 pin) — no address literal in this harness.
 *
 * RECONCILED 2026-07-13 against the landed Phase-2 surface: authored first against
 * local `*Stub` fragments matching `contracts/src/interfaces/{ILPFeeVault,
 * ICreatorVault}.sol`, then SWAPPED to the shared codegen ABIs the moment
 * robbed-shared regenerated them (coordinator-confirmed) — every name/signature
 * verified verbatim, no local stub remains.
 */
import { CREATOR_LP_SHARE_BPS, UNISWAP_V3, WETH_ADDRESS } from "@robbed/shared";
import {
  bondingCurveAbi,
  creatorVaultAbi,
  curveFactoryAbi,
  launchTokenAbi,
  lpFeeVaultAbi,
  swapRouter02Abi,
} from "@robbed/shared/abi";
import { type Address, type Hash, type Log, getAddress, parseEventLogs } from "viem";

import { ensureFunded, loadDeployedAddresses, publicClient, walletFor } from "./anvil";
import { ROLES, type DevAccount } from "./config";
import { forkV3 } from "./seed";

/** The 50/50 creator/treasury LP-fee split immutable expected by §12.69(A).
 *  Re-exported from the SINGLE shared source of truth (`@robbed/shared`
 *  `CREATOR_LP_SHARE_BPS`) — anti-drift cleanup (robbed-shared, 2026-07-13): the
 *  harness no longer carries its own `5000` literal, so a shared re-tune can never
 *  silently disagree with the CFEE specs. Still cross-checked LIVE on the fork
 *  against `LPFeeVault.creatorLpShareBps()` inside CFEE-1. */
export const EXPECTED_CREATOR_LP_SHARE_BPS = CREATOR_LP_SHARE_BPS;
/** The additive pre-grad creator leg (§12.68) — 0.5% of curve volume, in bps. */
export const EXPECTED_CREATOR_FEE_BPS = 50;
/** Canonical WETH (checksummed) — the post-grad WETH fee leg's ERC20 address. The
 *  V3 pool's two legs (launch token + WETH) are BOTH credited to the creator as
 *  ERC20 via `depositERC20` (LPFeeVault._route) — the WETH leg is NOT unwrapped. */
export const WETH: Address = getAddress(WETH_ADDRESS);

// ── vault addresses (live reads — no address literal in the harness) ──────────

/** The pull-payment CreatorVault address — live from `CurveFactory.creatorVault()`
 *  (§12.63(a)). Read live, never local.env, so it tracks whichever generation the
 *  fork deployed. */
export async function readCreatorVaultAddress(): Promise<Address> {
  const { curveFactory } = loadDeployedAddresses();
  return (await publicClient.readContract({
    address: curveFactory,
    abi: curveFactoryAbi,
    functionName: "creatorVault",
  })) as Address;
}

// ── §12.69(B) set-once creator registration reads (shared lpFeeVaultAbi) ──────

/** The set-once `tokenId → creator` the migrator registered at graduation
 *  (§12.69 B), read from the creator-aware LPFeeVault. */
export async function readCreatorOf(tokenId: bigint): Promise<Address> {
  const { lpFeeVault } = loadDeployedAddresses();
  return (await publicClient.readContract({
    address: lpFeeVault,
    abi: lpFeeVaultAbi,
    functionName: "creatorOf",
    args: [tokenId],
  })) as Address;
}

/** The immutable creator LP share in bps (§12.69 A) — expected 5000 (50/50). */
export async function readCreatorLpShareBps(): Promise<number> {
  const { lpFeeVault } = loadDeployedAddresses();
  return Number(
    await publicClient.readContract({
      address: lpFeeVault,
      abi: lpFeeVaultAbi,
      functionName: "creatorLpShareBps",
    }),
  );
}

/**
 * Attempt the migrator-gated set-once setter from an ARBITRARY signer (CFEE-4).
 * A non-migrator caller MUST revert; the harness returns the tx hash on the rare
 * chance a broken build lets it through so the spec can assert the mapping is
 * unchanged. NEVER used to actually register — only to prove it can't be spoofed.
 */
export async function registerCreatorAs(
  tokenId: bigint,
  creator: Address,
  by: DevAccount,
): Promise<Hash> {
  const wallet = walletFor(by);
  const { lpFeeVault } = loadDeployedAddresses();
  return wallet.writeContract({
    address: lpFeeVault,
    abi: lpFeeVaultAbi,
    functionName: "registerCreator",
    args: [tokenId, creator],
  });
}

// ── CreatorVault balances (shared creatorVaultAbi) ────────────────────────────

/** The creator's claimable NATIVE-ETH balance in the CreatorVault — the PRE-GRAD
 *  curve creator leg ONLY (§12.68; swept via `sweepCreatorFees` → `deposit`). The
 *  post-grad V3 legs are ERC20 (BOTH the launch token AND WETH — `LPFeeVault._route`
 *  routes each via `depositERC20`, never unwrapped), so they land in
 *  `tokenBalanceOf`, not here. `CreatorVault.balanceOf`. */
export async function readCreatorEthClaimable(creator: Address): Promise<bigint> {
  const vault = await readCreatorVaultAddress();
  return (await publicClient.readContract({
    address: vault,
    abi: creatorVaultAbi,
    functionName: "balanceOf",
    args: [creator],
  })) as bigint;
}

/** The creator's claimable ERC20 balance per `(creator, token)` in the CreatorVault
 *  — BOTH post-grad V3 legs land here as ERC20 (the launch-token leg AND the WETH
 *  leg; `collect()` routes each via `depositERC20`, NOT unwrapped — `LPFeeVault.
 *  _route`). Pass `token = WETH` for the WETH leg. `CreatorVault.tokenBalanceOf`. */
export async function readCreatorTokenClaimable(
  creator: Address,
  token: Address,
): Promise<bigint> {
  const vault = await readCreatorVaultAddress();
  return (await publicClient.readContract({
    address: vault,
    abi: creatorVaultAbi,
    functionName: "tokenBalanceOf",
    args: [creator, token],
  })) as bigint;
}

/** Plain ERC-20 balance of the launch token (shared launchTokenAbi) — used to
 *  prove a `claimERC20` actually delivered the token-leg to the creator. */
export async function readTokenBalance(account: Address, token: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: token,
    abi: launchTokenAbi,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

// ── claim drivers (pull-payment, §12.25 / §12.69 C) ───────────────────────────

/** Claim the creator's ETH-leg from the CreatorVault (`claim(creator)`, shared).
 *  Permissionless: `by` may be anyone; the funds always go to `creator`. */
export async function claimCreatorEth(creator: Address, by?: DevAccount): Promise<Hash> {
  const vault = await readCreatorVaultAddress();
  const wallet = walletFor(by ?? ROLES.trader);
  return wallet.writeContract({
    address: vault,
    abi: creatorVaultAbi,
    functionName: "claim",
    args: [creator],
  });
}

/** Claim the creator's token-leg from the CreatorVault (`claimERC20(creator, token)`). */
export async function claimCreatorToken(
  creator: Address,
  token: Address,
  by?: DevAccount,
): Promise<Hash> {
  const vault = await readCreatorVaultAddress();
  const wallet = walletFor(by ?? ROLES.trader);
  return wallet.writeContract({
    address: vault,
    abi: creatorVaultAbi,
    functionName: "claimERC20",
    args: [creator, token],
  });
}

// ── pre-grad curve creator leg (§12.68) ───────────────────────────────────────

/** Permissionless `BondingCurve.sweepCreatorFees()` (shared) — pushes the curve's
 *  accrued creator leg to the CreatorVault, credited to `creatorOf`. */
export async function sweepCreatorFeesOnChain(curve: Address, by?: DevAccount): Promise<Hash> {
  const wallet = walletFor(by ?? ROLES.trader);
  return wallet.writeContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "sweepCreatorFees",
    args: [],
  });
}

/** The curve's in-contract accrued creator-fee escrow (shared `accruedCreatorFees`). */
export async function readAccruedCreatorFees(curve: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: curve,
    abi: bondingCurveAbi,
    functionName: "accruedCreatorFees",
  })) as bigint;
}

/** The curve's live creator-fee leg in bps (`CREATOR_FEE_BPS`, shared) — expected 50. */
export async function readCurveCreatorFeeBps(curve: Address): Promise<number> {
  return Number(
    await publicClient.readContract({
      address: curve,
      abi: bondingCurveAbi,
      functionName: "CREATOR_FEE_BPS",
    }),
  );
}

// ── the split collect() outcome ───────────────────────────────────────────────

export interface CollectSplit {
  tokenId: bigint;
  /** The `FeesSplit.creator` the vault credited (== `creatorOf[tokenId]`). */
  creator: Address;
  /** Totals harvested per leg (pre-split), mapped to the WETH side + token side. */
  wethLeg: bigint;
  tokenLeg: bigint;
  /** The 50/50 split amounts per leg (from `FeesSplit`) — `creator+treasury == leg`. */
  creatorWeth: bigint;
  treasuryWeth: bigint;
  creatorToken: bigint;
  treasuryToken: bigint;
}

/**
 * Parse a split `collect(tokenId)` receipt: the per-leg TOTAL harvested (shared
 * `lpFeeVaultAbi` `FeesCollected(tokenId, amount0, amount1)`) AND the per-leg 50/50
 * split (§12.69(G) `FeesSplit(tokenId, creator, treasury0, creator0, treasury1,
 * creator1)`, shared lpFeeVaultAbi). Both amount0/amount1 and treasury0/creator0/… are
 * mapped from V3 token ordering (`token0 = lower address`) to WETH-leg / token-leg
 * semantics so the specs never care which side is token0.
 */
export function parseCollectSplit(logs: Log[], token: Address): CollectSplit {
  const [collected] = parseEventLogs({ abi: lpFeeVaultAbi, logs, eventName: "FeesCollected" });
  if (!collected) throw new Error("[e2e] no FeesCollected log in the collect() receipt");
  const [split] = parseEventLogs({
    abi: lpFeeVaultAbi,
    logs,
    eventName: "FeesSplit",
  });
  if (!split) throw new Error("[e2e] no FeesSplit log in the collect() receipt");
  const c = collected.args as { tokenId: bigint; amount0: bigint; amount1: bigint };
  const s = split.args as {
    creator: Address;
    treasury0: bigint;
    creator0: bigint;
    treasury1: bigint;
    creator1: bigint;
  };
  // token0 is the numerically-lower address; WETH may be token0 or token1.
  const wethIsToken0 = getAddress(WETH_ADDRESS) < getAddress(token);
  return {
    tokenId: c.tokenId,
    creator: s.creator,
    wethLeg: wethIsToken0 ? c.amount0 : c.amount1,
    tokenLeg: wethIsToken0 ? c.amount1 : c.amount0,
    creatorWeth: wethIsToken0 ? s.creator0 : s.creator1,
    treasuryWeth: wethIsToken0 ? s.treasury0 : s.treasury1,
    creatorToken: wethIsToken0 ? s.creator1 : s.creator0,
    treasuryToken: wethIsToken0 ? s.treasury1 : s.treasury0,
  };
}

// ── post-grad V3 volume generation (SwapRouter02 exactInputSingle, §12.28) ─────
// SwapRouter02 (@uniswap/swap-router-contracts) DROPS the `deadline` field from
// ExactInputSingleParams (deadline moves to the `multicall(deadline, bytes[])`
// wrapper) — pinned in @robbed/shared/abi `swapRouter02Abi`. A WETH-in swap sent
// with `value` is auto-wrapped by the router (native ETH in); the 1%-fee pool
// takes its fee from each swap's INPUT token, so a buy accrues the WETH-leg and a
// sell the token-leg — both legs are needed for a two-sided `collect()` split.

/** Buy `token` with native ETH through the graduated V3 1% pool (WETH-leg fee). */
export async function v3BuyExactEth(
  token: Address,
  ethWei: bigint,
  by?: DevAccount,
): Promise<Hash> {
  const buyer = by ?? ROLES.trader2;
  const wallet = walletFor(buyer);
  return wallet.writeContract({
    address: getAddress(UNISWAP_V3.swapRouter02),
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: getAddress(WETH_ADDRESS),
        tokenOut: token,
        fee: forkV3().feeTier,
        recipient: buyer.address,
        amountIn: ethWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
    value: ethWei,
  });
}

/**
 * Buy through the V3 pool and RETRY until a success receipt (returns it). Same
 * inclusion-race mitigation as `generatePostGradFees`: on the block-time-2 shared
 * fork with the keeper active, an `exactInputSingle` can pass gas-estimation yet
 * revert at inclusion a block later if the freshly-graduated pool's state shifts.
 * Used where a spec asserts a post-grad trade SUCCEEDS (CFEE-3) — the revert is a
 * venue timing artifact, never the property under test, so retrying is correct.
 */
export async function v3BuyExactEthConfirmed(
  token: Address,
  ethWei: bigint,
  by?: DevAccount,
): Promise<{ hash: Hash; status: "success" }> {
  const buyer = by ?? ROLES.trader2;
  await ensureFunded(buyer.address);
  let lastReason = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const hash = await v3BuyExactEth(token, ethWei, buyer).catch((e: any) => {
      lastReason = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]!;
      return null;
    });
    if (hash) {
      const r = await publicClient.waitForTransactionReceipt({ hash }).catch(() => null);
      if (r?.status === "success") return { hash, status: "success" };
      if (r?.status === "reverted") lastReason = await revertReason(hash);
    }
    await new Promise((res) => setTimeout(res, 1_500));
  }
  throw new Error(
    `[e2e] v3BuyExactEthConfirmed: the post-grad V3 buy never landed a success receipt ` +
      `after retries (last: ${lastReason || "no receipt"}) — venue timing artifact, not the assertion under test.`,
  );
}

/** Sell `tokenWei` of `token` for WETH through the V3 pool (token-leg fee).
 *  Approves the token to SwapRouter02 first (exact-input needs the pull). */
export async function v3SellExactToken(
  token: Address,
  tokenWei: bigint,
  by?: DevAccount,
): Promise<Hash> {
  const seller = by ?? ROLES.trader2;
  const wallet = walletFor(seller);
  const router = getAddress(UNISWAP_V3.swapRouter02);
  const approveHash = await wallet.writeContract({
    address: token,
    abi: launchTokenAbi,
    functionName: "approve",
    args: [router, tokenWei],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  return wallet.writeContract({
    address: router,
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: token,
        tokenOut: getAddress(WETH_ADDRESS),
        fee: forkV3().feeTier,
        recipient: seller.address,
        amountIn: tokenWei,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
}

/**
 * Generate two-sided post-grad V3 volume so `collect()` has fees to split in BOTH
 * legs: a native-ETH buy (WETH-leg) then a partial token sell (token-leg). Returns
 * the summed WETH notional swapped (buy + sell-proceeds ≈ the volume the 0.5%
 * creator rate is measured against).
 *
 * DETERMINISM (why the buy is retried): the shared fork mines every ~2s
 * (`anvil --block-time 2`), so an `exactInputSingle` can pass viem's gas-estimation
 * at read-time yet REVERT at inclusion a block later if the freshly-graduated pool's
 * state shifts under it (the migrator's in-tx arb-back can leave the tick right at a
 * boundary). A silently-swallowed buy accrued NO collectable fee, which surfaced as a
 * cryptic "fees == 0" split assertion downstream. So we now (a) fund + strip any
 * inherited sweeper on the buyer, (b) RETRY the buy until it actually delivers tokens,
 * and (c) throw a CLEAR, reason-carrying error if it genuinely can't — never a
 * confusing zero. This is test-volume generation only; it weakens no product guarantee.
 */
export async function generatePostGradFees(
  token: Address,
  opts: { ethIn?: bigint; by?: DevAccount } = {},
): Promise<{ wethNotional: bigint }> {
  const by = opts.by ?? ROLES.trader2;
  const ethIn = opts.ethIn ?? 5n * 10n ** 16n; // 0.05 ETH default
  // Clean, funded EOA: received tokens/ETH can't be drained by an inherited sweeper.
  await ensureFunded(by.address);

  let bought = 0n;
  let lastReason = "";
  for (let attempt = 0; attempt < 5 && bought === 0n; attempt++) {
    const before = await readTokenBalance(by.address, token);
    const buyHash = await v3BuyExactEth(token, ethIn, by).catch((e: any) => {
      lastReason = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]!;
      return null;
    });
    if (buyHash) {
      const r = await publicClient
        .waitForTransactionReceipt({ hash: buyHash })
        .catch(() => null);
      if (r?.status === "success") {
        bought = (await readTokenBalance(by.address, token)) - before;
      } else if (r?.status === "reverted") {
        // Replay the reverted call to recover the on-chain reason for the report.
        lastReason = await revertReason(buyHash);
      }
    }
    if (bought === 0n) await new Promise((r) => setTimeout(r, 1_500));
  }
  if (bought === 0n) {
    throw new Error(
      `[e2e] generatePostGradFees: the post-grad V3 buy delivered no tokens after retries ` +
        `(last: ${lastReason || "no receipt"}). This is a venue/fee-generation issue, NOT a ` +
        `creator-split assertion — investigate the graduated pool, do not weaken the split check.`,
    );
  }
  // Sell back roughly half so the token-leg fee accrues too (best-effort — the buy
  // leg alone already produced a collectable WETH-leg fee).
  const sellHash = await v3SellExactToken(token, bought / 2n, by).catch(() => null);
  if (sellHash) await publicClient.waitForTransactionReceipt({ hash: sellHash }).catch(() => {});
  return { wethNotional: ethIn };
}

/** Replay a reverted tx via `eth_call` at its block to recover the revert reason. */
async function revertReason(hash: Hash): Promise<string> {
  try {
    const tx = await publicClient.getTransaction({ hash });
    await publicClient.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: tx.blockNumber ?? undefined,
    });
    return "reverted (no reason surfaced on replay)";
  } catch (e: any) {
    return String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]!;
  }
}
