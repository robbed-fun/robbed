/**
 * ROBBED_ auto-graduation keeper entrypoint (Bun runtime).
 *
 * Wiring:
 *   1. on-chain GraduationReady watch (primary detection — see chain.ts) → onReady
 *   2. periodic DB sweep (fallback — catches WS drops / downtime; see db.ts)
 *   3. balance-watch loop (low-balance alert + healthz cache)
 *   4. LP fee collection sweep (post-grad V3 fees → Safe + CreatorVault)
 *   5. GET /healthz (compose healthcheck)
 * All graduate() execution goes through the pure GraduationKeeper core.
 */
import { loadConfig, isWebSocketUrl } from "./config";
import { ChainClient } from "./chain";
import { PgKeeperDb } from "./db.pg";
import { GraduationKeeper } from "./keeper";
import { TreasuryFeeSweeper } from "./treasury-sweeper";
import { LpFeeCollector } from "./lp-fee-collector";
import { KeeperMetrics } from "./metrics";
import { jsonLogger } from "./logger";
import { startHealthServer, type WalletState } from "./health";
import type { KeeperClock } from "./types";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = jsonLogger;

  const chain = new ChainClient({
    rpcUrl: cfg.KEEPER_RPC_URL,
    privateKey: cfg.KEEPER_PRIVATE_KEY as `0x${string}`,
    chainId: cfg.CHAIN_ID,
  });
  const db = new PgKeeperDb(cfg.DATABASE_URL);
  const metrics = new KeeperMetrics();
  const clock: KeeperClock = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  const keeper = new GraduationKeeper({
    chain,
    db,
    metrics,
    log,
    clock,
    tuning: {
      maxAttempts: cfg.KEEPER_MAX_ATTEMPTS,
      gasCap: cfg.KEEPER_GAS_CAP,
      backoffBaseMs: cfg.KEEPER_BACKOFF_BASE_MS,
      failedCooldownMs: cfg.KEEPER_FAILED_COOLDOWN_MS,
    },
  });
  const treasurySweeper = new TreasuryFeeSweeper({
    chain,
    db,
    metrics,
    log,
    clock,
    tuning: {
      gasCap: cfg.KEEPER_GAS_CAP,
      minSweepWei: cfg.KEEPER_TREASURY_SWEEP_MIN_WEI,
      maxSweepAgeMs: cfg.KEEPER_TREASURY_SWEEP_MAX_AGE_MS,
    },
  });
  const lpFeeCollector = cfg.KEEPER_LP_FEE_COLLECT_ENABLED
    ? new LpFeeCollector({
        chain,
        db,
        metrics,
        log,
        clock,
        tuning: {
          vault: cfg.KEEPER_LP_FEE_VAULT_ADDRESS!.toLowerCase() as `0x${string}`,
          gasCap: cfg.KEEPER_GAS_CAP,
          minCollectWethWei: cfg.KEEPER_LP_FEE_COLLECT_MIN_WETH_WEI,
          maxCollectAgeMs: cfg.KEEPER_LP_FEE_COLLECT_MAX_AGE_MS,
        },
      })
    : null;

  // Fail-closed chain-identity gate (mirrors the indexer discipline).
  const liveChainId = await chain.getChainId();
  if (liveChainId !== cfg.CHAIN_ID) {
    throw new Error(
      `[keeper] chain-id mismatch: RPC reports ${liveChainId}, CHAIN_ID=${cfg.CHAIN_ID}`,
    );
  }
  const detection = isWebSocketUrl(cfg.KEEPER_RPC_URL) ? "ws-subscription" : "http-polling";
  log.info("startup", {
    wallet: chain.walletAddress,
    chainId: cfg.CHAIN_ID,
    detection,
    pollMs: cfg.KEEPER_POLL_MS,
    treasurySweepEnabled: cfg.KEEPER_TREASURY_SWEEP_ENABLED,
    treasurySweepPollMs: cfg.KEEPER_TREASURY_SWEEP_POLL_MS,
    treasurySweepMinWei: cfg.KEEPER_TREASURY_SWEEP_MIN_WEI.toString(),
    treasurySweepMaxAgeMs: cfg.KEEPER_TREASURY_SWEEP_MAX_AGE_MS,
    lpFeeCollectEnabled: cfg.KEEPER_LP_FEE_COLLECT_ENABLED,
    lpFeeVault: cfg.KEEPER_LP_FEE_VAULT_ADDRESS?.toLowerCase(),
    lpFeeCollectPollMs: cfg.KEEPER_LP_FEE_COLLECT_POLL_MS,
    lpFeeCollectMinWethWei: cfg.KEEPER_LP_FEE_COLLECT_MIN_WETH_WEI.toString(),
    lpFeeCollectMaxAgeMs: cfg.KEEPER_LP_FEE_COLLECT_MAX_AGE_MS,
  });

  // ── balance watch ──────────────────────────────────────────────────────────
  const wallet: WalletState = {
    address: chain.walletAddress,
    balanceWei: 0n,
    warnThresholdWei: 0n,
    low: false,
    updatedAt: null,
  };
  async function refreshBalance(): Promise<void> {
    try {
      const [balanceWei, gasPrice] = await Promise.all([
        chain.getBalanceWei(),
        chain.getGasPriceWei(),
      ]);
      const typicalCost = cfg.KEEPER_TYPICAL_GRADUATE_GAS * gasPrice;
      const threshold = typicalCost * BigInt(cfg.KEEPER_BALANCE_WARN_MULTIPLE);
      const low = balanceWei < threshold;
      wallet.balanceWei = balanceWei;
      wallet.warnThresholdWei = threshold;
      wallet.low = low;
      wallet.updatedAt = Date.now();
      if (low) {
        log.error("keeper_wallet_low_balance", {
          alert: "top_up_required",
          wallet: wallet.address,
          balanceWei: balanceWei.toString(),
          warnThresholdWei: threshold.toString(),
          typicalGraduationsCovered: typicalCost > 0n ? Number(balanceWei / typicalCost) : null,
        });
      }
    } catch (err) {
      log.warn("balance_refresh_failed", { err: String(err) });
    }
  }
  await refreshBalance();
  const balanceTimer = setInterval(() => void refreshBalance(), cfg.KEEPER_BALANCE_POLL_MS);

  // ── health server ────────────────────────────────────────────────────────────
  const health = startHealthServer({
    port: cfg.KEEPER_PORT,
    keeper,
    metrics,
    getWallet: () => wallet,
    detection,
    stalenessMs: cfg.KEEPER_POLL_MS * 4,
  });

  // ── fallback sweep ───────────────────────────────────────────────────────────
  async function runSweep(): Promise<void> {
    try {
      const results = await keeper.sweep();
      const acted = results.filter(
        (r) =>
          r.status === "graduated" ||
          r.status === "already_graduated" ||
          r.status === "failed_persistent",
      );
      if (acted.length > 0)
        log.info("sweep_results", {
          acted: acted.map((r) => ({ curve: r.curve, status: r.status })),
        });
    } catch (err) {
      log.error("sweep_failed", { err: String(err) });
    }
  }
  // Immediate catch-up sweep (curves locked while the keeper was down), then loop.
  await runSweep();
  const sweepTimer = setInterval(() => void runSweep(), cfg.KEEPER_POLL_MS);

  // ── treasury fee sweep ───────────────────────────────────────────────────────
  async function runTreasurySweep(): Promise<void> {
    if (!cfg.KEEPER_TREASURY_SWEEP_ENABLED) return;
    try {
      const results = await treasurySweeper.sweep();
      const acted = results.filter((r) => r.status === "swept" || r.status === "failed");
      if (acted.length > 0) {
        log.info("treasury_sweep_results", {
          acted: acted.map((r) => ({
            curve: r.curve,
            token: r.token,
            status: r.status,
            amountWei: r.amountWei?.toString(),
            txHash: r.txHash,
          })),
        });
      }
    } catch (err) {
      log.error("treasury_sweep_failed", { err: String(err) });
    }
  }
  await runTreasurySweep();
  const treasurySweepTimer = cfg.KEEPER_TREASURY_SWEEP_ENABLED
    ? setInterval(() => void runTreasurySweep(), cfg.KEEPER_TREASURY_SWEEP_POLL_MS)
    : null;

  // ── post-grad LP fee collection ─────────────────────────────────────────────
  async function runLpFeeCollect(): Promise<void> {
    if (!lpFeeCollector) return;
    try {
      const results = await lpFeeCollector.collect();
      const acted = results.filter((r) => r.status === "collected" || r.status === "failed");
      if (acted.length > 0) {
        log.info("lp_fee_collect_results", {
          acted: acted.map((r) => ({
            token: r.token,
            pool: r.pool,
            lpTokenId: r.lpTokenId.toString(),
            status: r.status,
            amount0: r.amount0?.toString(),
            amount1: r.amount1?.toString(),
            wethAmount: r.wethAmount?.toString(),
            txHash: r.txHash,
          })),
        });
      }
    } catch (err) {
      log.error("lp_fee_collect_sweep_failed", { err: String(err) });
    }
  }
  await runLpFeeCollect();
  const lpFeeCollectTimer = lpFeeCollector
    ? setInterval(() => void runLpFeeCollect(), cfg.KEEPER_LP_FEE_COLLECT_POLL_MS)
    : null;

  // ── primary detection: on-chain GraduationReady ──────────────────────────────
  const unwatch = chain.watchGraduationReady(
    (curve) => {
      log.info("graduation_ready_seen", { curve });
      void keeper
        .onReady(curve)
        .catch((err) => log.error("on_ready_failed", { curve, err: String(err) }));
    },
    (err) => log.warn("graduation_watch_error", { err: String(err) }),
  );

  // ── graceful shutdown ────────────────────────────────────────────────────────
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutdown", { signal });
    clearInterval(sweepTimer);
    if (treasurySweepTimer) clearInterval(treasurySweepTimer);
    if (lpFeeCollectTimer) clearInterval(lpFeeCollectTimer);
    clearInterval(balanceTimer);
    try {
      unwatch();
    } catch {
      /* ignore */
    }
    health.stop();
    await db.close().catch(() => {});
    process.exit(0);
  }
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // Loud, structured fatal — do not exit 0 on a boot failure.
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      service: "keeper",
      event: "fatal",
      err: String(err),
    }),
  );
  process.exit(1);
});
