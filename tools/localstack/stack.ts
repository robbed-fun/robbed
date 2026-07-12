#!/usr/bin/env bun
/**
 * ── dev:stack — readiness-gated one-command bring-up (plan item I-3, gate G-1) ──
 *
 * `docker compose up -d --build`, then poll `docker compose ps` until EVERY
 * long-running service is healthy (or running, for services without a
 * healthcheck) and every one-shot (deps, createbuckets, apimigrations,
 * deploychain) has exited 0. Bounded timeout; on failure/timeout it fails LOUD:
 * the offending service's last log lines are printed before exit 1.
 *
 * Decision basis (recorded per the decide-it-yourself loop):
 *  - Service classification is derived from live `docker compose ps --all
 *    --format json` state (State/Health/ExitCode), NOT a hardcoded service
 *    list — the expected set comes from `docker compose config --services`,
 *    so compose-file changes never drift this script. Compose v2 emits NDJSON
 *    for `--format json` (docs.docker.com/reference/cli/docker/compose/ps/,
 *    verified against the local daemon output 2026-07-11); an array fallback
 *    is kept for older daemons.
 *  - "Ready" per service: exited→ExitCode==0 (one-shot success); running with
 *    a healthcheck→Health=="healthy"; running without one→running is enough.
 *    `unhealthy` (retries exhausted) and non-zero exit are terminal failures —
 *    fail fast rather than waiting out the timeout.
 *  - The indexer gates on Ponder's /ready (healthcheck added in compose):
 *    /ready answers 200 only once historical indexing completes (ponder.sh
 *    docs, observability — verified 2026-07-11), so dev:health's head checks
 *    run against a caught-up indexer.
 *
 * Env knobs:
 *   DEV_STACK_TIMEOUT_SECS  overall readiness deadline AFTER `up -d --build`
 *                           returns (default 900 — first boot compiles apps).
 *   DEV_STACK_NO_BUILD      "1" runs `up -d` WITHOUT `--build`. CI (ci.yml e2e
 *                           job, plan I-6) pre-builds the `robbed-dev` image via
 *                           docker/build-push-action with a GHA layer cache and
 *                           `load: true`; buildx's docker-container driver keeps
 *                           a separate layer cache from the daemon's builder, so
 *                           an unconditional `--build` there would silently
 *                           rebuild from scratch and waste the cache. Default
 *                           (local dev) is unchanged: always `--build`.
 *
 * Run: `bun run dev:stack` (root package.json).
 */
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TIMEOUT_MS = Number(process.env.DEV_STACK_TIMEOUT_SECS ?? 900) * 1000;
const POLL_MS = 3000;
const FAIL_LOG_TAIL = 40;

interface PsRow {
  Service: string;
  State: string; // running | exited | created | restarting | dead | paused
  Health: string; // healthy | unhealthy | starting | "" (no healthcheck)
  ExitCode: number;
}

type Verdict = "ready" | "pending" | "failed";

async function compose(
  args: string[],
  opts: { inherit?: boolean } = {},
): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["docker", "compose", ...args], {
    cwd: ROOT,
    stdout: opts.inherit ? "inherit" : "pipe",
    stderr: "inherit",
  });
  const stdout = opts.inherit ? "" : await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

/** Parse `ps --all --format json` output — NDJSON (compose v2.21+) or a JSON array. */
function parsePs(raw: string): Map<string, PsRow> {
  const rows: PsRow[] = [];
  const trimmed = raw.trim();
  if (trimmed === "") return new Map();
  if (trimmed.startsWith("[")) {
    rows.push(...(JSON.parse(trimmed) as PsRow[]));
  } else {
    for (const line of trimmed.split("\n")) {
      if (line.trim() === "") continue;
      rows.push(JSON.parse(line) as PsRow);
    }
  }
  // One container per service in this stack; last row wins if docker reports dupes.
  return new Map(rows.map((r) => [r.Service, r]));
}

function verdict(row: PsRow | undefined): { verdict: Verdict; detail: string } {
  if (!row) return { verdict: "pending", detail: "not created yet" };
  const health = row.Health ?? "";
  switch (row.State) {
    case "exited":
      return row.ExitCode === 0
        ? { verdict: "ready", detail: "one-shot exited 0" }
        : { verdict: "failed", detail: `exited ${row.ExitCode}` };
    case "running":
      if (health === "healthy") return { verdict: "ready", detail: "healthy" };
      if (health === "unhealthy") return { verdict: "failed", detail: "unhealthy (healthcheck retries exhausted)" };
      if (health === "") return { verdict: "ready", detail: "running (no healthcheck)" };
      return { verdict: "pending", detail: `running (health: ${health})` };
    case "dead":
      return { verdict: "failed", detail: "dead" };
    default:
      // created (waiting on depends_on), restarting, paused, …
      return { verdict: "pending", detail: row.State };
  }
}

async function dumpLogs(services: string[]): Promise<void> {
  for (const svc of services) {
    console.error(`\n[stack] ── last ${FAIL_LOG_TAIL} log lines: ${svc} ──`);
    await compose(["logs", "--no-color", `--tail=${FAIL_LOG_TAIL}`, svc], { inherit: true });
  }
}

async function main(): Promise<void> {
  const upArgs =
    process.env.DEV_STACK_NO_BUILD === "1" ? ["up", "-d"] : ["up", "-d", "--build"];
  console.log(`[stack] docker compose ${upArgs.join(" ")} …`);
  const up = await compose(upArgs, { inherit: true });
  if (up.code !== 0) {
    console.error(`[stack] FAIL — \`docker compose ${upArgs.join(" ")}\` exited ${up.code}`);
    process.exit(1);
  }

  const svcOut = await compose(["config", "--services"]);
  if (svcOut.code !== 0) {
    console.error("[stack] FAIL — `docker compose config --services` failed");
    process.exit(1);
  }
  const expected = svcOut.stdout.trim().split("\n").filter(Boolean).sort();
  console.log(`[stack] waiting for ${expected.length} services: ${expected.join(", ")}`);
  console.log(`[stack] deadline: ${Math.round(TIMEOUT_MS / 1000)}s (DEV_STACK_TIMEOUT_SECS to override)`);

  const started = Date.now();
  const lastPrinted = new Map<string, string>();

  for (;;) {
    const ps = await compose(["ps", "--all", "--format", "json"]);
    if (ps.code !== 0) {
      console.error("[stack] FAIL — `docker compose ps` failed");
      process.exit(1);
    }
    const rows = parsePs(ps.stdout);

    const failed: string[] = [];
    const pending: string[] = [];
    for (const svc of expected) {
      const v = verdict(rows.get(svc));
      const line = `${v.verdict}: ${v.detail}`;
      if (lastPrinted.get(svc) !== line) {
        lastPrinted.set(svc, line);
        const mark = v.verdict === "ready" ? "✔" : v.verdict === "failed" ? "✘" : "…";
        console.log(`[stack] ${mark} ${svc.padEnd(14)} ${v.detail}`);
      }
      if (v.verdict === "failed") failed.push(svc);
      if (v.verdict === "pending") pending.push(svc);
    }

    if (failed.length > 0) {
      console.error(`\n[stack] FAIL — service(s) in terminal failure state: ${failed.join(", ")}`);
      await dumpLogs(failed);
      process.exit(1);
    }
    if (pending.length === 0) {
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`\n[stack] all ${expected.length} services ready in ${secs}s — run \`bun run dev:health\` for the G-1 checklist.`);
      process.exit(0);
    }
    if (Date.now() - started > TIMEOUT_MS) {
      console.error(`\n[stack] FAIL — timeout after ${Math.round(TIMEOUT_MS / 1000)}s; still pending: ${pending.join(", ")}`);
      await dumpLogs(pending);
      process.exit(1);
    }
    await Bun.sleep(POLL_MS);
  }
}

await main();
