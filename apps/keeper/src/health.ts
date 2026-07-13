/**
 * GET /healthz — for the compose healthcheck + ops. Reports last sweep time,
 * pending/in-flight curves, and the (cached) wallet balance. NO synchronous
 * chain/DB read in the handler: balance is refreshed by the balance-poll loop
 * and read from a shared snapshot.
 *
 * Liveness: 200 while the process is alive; 503 only once the sweep loop has run
 * at least once AND the last sweep is older than `stalenessMs` (a genuinely
 * stuck loop). A LOW wallet balance is reported as `status:"degraded"` with 200
 * — it is an alert to top up the wallet, not a reason to kill the container.
 */
import type { KeeperMetrics } from "./metrics";
import type { GraduationKeeper } from "./keeper";

export interface WalletState {
  address: string;
  balanceWei: bigint;
  warnThresholdWei: bigint;
  low: boolean;
  updatedAt: number | null;
}

export interface HealthServerOptions {
  port: number;
  keeper: GraduationKeeper;
  metrics: KeeperMetrics;
  getWallet: () => WalletState;
  detection: "ws-subscription" | "http-polling";
  stalenessMs: number;
  now?: () => number;
}

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function buildHealthBody(opts: HealthServerOptions): { status: "ok" | "degraded" | "stale"; body: unknown } {
  const now = (opts.now ?? Date.now)();
  const m = opts.metrics.snapshot();
  const wallet = opts.getWallet();
  const stale = m.lastSweepAt !== null && now - m.lastSweepAt > opts.stalenessMs;
  const status: "ok" | "degraded" | "stale" = stale ? "stale" : wallet.low ? "degraded" : "ok";
  return {
    status,
    body: toJsonSafe({
      status,
      detection: opts.detection,
      inFlight: opts.keeper.inFlightCount,
      cooldown: opts.keeper.cooldownCount,
      wallet: {
        address: wallet.address,
        balanceWei: wallet.balanceWei,
        warnThresholdWei: wallet.warnThresholdWei,
        low: wallet.low,
        updatedAt: wallet.updatedAt,
      },
      metrics: m,
      now,
    }),
  };
}

export function startHealthServer(opts: HealthServerOptions): { stop: () => void } {
  const server = Bun.serve({
    port: opts.port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/healthz") {
        const { status, body } = buildHealthBody(opts);
        return Response.json(body, { status: status === "stale" ? 503 : 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { stop: () => server.stop(true) };
}
