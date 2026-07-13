/**
 * Structured JSON logger (one line per event, machine-greppable). Matches the
 * "structured error + a counter/metric" requirement — a persistent-revert alert
 * is a distinct `level:"error"` line with `event:"graduation_failed_persistent"`
 * that ops/alerting keys on (deploy.md H.5).
 */
import type { KeeperLogger } from "./types";

function emit(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: "keeper", event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const jsonLogger: KeeperLogger = {
  info: (event, fields) => emit("info", event, fields),
  warn: (event, fields) => emit("warn", event, fields),
  error: (event, fields) => emit("error", event, fields),
};
