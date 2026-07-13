# syntax=docker/dockerfile:1
#
# ROBBED_ indexer image — Ponder (spec §8: "Ponder runs in a Node container").
# Build context = REPO ROOT (so pnpm-lock.yaml + pnpm-workspace.yaml + the
# `@robbed/shared` workspace package resolve for `workspace:*`).
#   docker build -f apps/indexer/Dockerfile -t robbed-indexer .
#
# Docs-first (2026-07-10):
#   - Ponder self-hosting (ponder.sh/docs/production/self-hosting): `ponder start`;
#     /health (200 on boot) + /ready (200 once realtime, 503 during backfill) on
#     the web-server port (default 42069); each deploy uses a distinct DATABASE_SCHEMA.
#   - pnpm Docker (pnpm.io/docker, pnpm.io/cli/deploy): corepack-pinned pnpm,
#     `pnpm deploy --legacy --prod` produces a self-contained folder with a REAL
#     (non-symlinked) node_modules — the reliable way to move a filtered workspace
#     package into a slim runtime stage without pnpm's virtual-store symlinks.
#   - Node 22 base per prod-images.md.
#
# Multi-stage: base (pnpm) → build (install + codegen + deploy bundle) → runtime.

# ── base: Node 22 + corepack-pinned pnpm (matches root packageManager) ────────
# Exact pin 22.22.0 = the recorded toolchain Node (docs/developers/runbooks/toolchain.md);
# tag existence verified against the registry 2026-07-11 (P-3 pinned-base rule).
FROM node:22.22.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm/bin:$PATH
# node-gyp toolchain for the root `pnpm.onlyBuiltDependencies` native modules
# (bufferutil / utf-8-validate — ws accelerators used by viem/ponder websockets)
# + git for the root `prepare` hook (`git config core.hooksPath .githooks` needs
# a repo; `.git` is dockerignored, so an empty one is init'd in WORKDIR below).
# BUILD stage only; the runtime stage never installs compilers or git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
RUN git init -q .

# ── build: filtered workspace install → ponder codegen → prod deploy bundle ───
FROM base AS build
# Manifests + lockfile first (layer cache: deps re-install only when these change).
# ALL workspace manifests are copied so `--frozen-lockfile` sees the same project
# graph the lockfile was written against; the `--filter` then narrows what installs.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json         apps/api/package.json
COPY apps/indexer/package.json     apps/indexer/package.json
COPY apps/web/package.json         apps/web/package.json
COPY packages/shared/package.json  packages/shared/package.json
# Install only @robbed/indexer + its workspace deps (@robbed/shared); web/api deps
# are skipped by the filter, keeping the image small.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @robbed/indexer...

# Source for the indexer + its only workspace dep.
COPY packages/shared  packages/shared
COPY apps/indexer      apps/indexer

# `ponder codegen` loads ponder.config.ts, which fail-closed-asserts required env
# (INDEXER_RPC_HTTP + non-zero CURVE_FACTORY/MIGRATOR addresses; assertions.ts).
# These are BUILD-ONLY placeholders that exist solely so the typegen pass runs;
# they are NOT runtime config and never reach the running container (real values
# come from Komodo env at deploy). Overridable as build args.
ARG CODEGEN_RPC_HTTP=http://codegen.invalid
ARG CODEGEN_CURVE_FACTORY=0x0000000000000000000000000000000000000001
ARG CODEGEN_MIGRATOR=0x0000000000000000000000000000000000000001
RUN INDEXER_RPC_HTTP="$CODEGEN_RPC_HTTP" \
    CURVE_FACTORY_ADDRESS="$CODEGEN_CURVE_FACTORY" \
    MIGRATOR_ADDRESS="$CODEGEN_MIGRATOR" \
    pnpm --filter @robbed/indexer exec ponder codegen

# Self-contained bundle at /out (real node_modules; scripts/, migrations/,
# ponder.config.ts, ponder.schema.ts, src/ all preserved). --legacy because this
# workspace does not set inject-workspace-packages (pnpm.io/cli/deploy).
RUN pnpm --filter @robbed/indexer --prod --legacy deploy /out

# ── runtime: Node 22 (Ponder's runtime) + bun binary for the TS side-scripts ──
# Ponder itself runs under NODE (spec §8). `bun` is copied in ONLY to execute the
# TypeScript offchain scripts (scripts/migrate.ts, scripts/rebuild.ts) — the same
# `bun run` the package.json scripts + dev compose use. This does not change the
# indexer's runtime (Ponder = Node); it avoids a fragile TS loader for two scripts.
FROM node:22.22.0-bookworm-slim AS runtime
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
# curl for the compose /health probe; ca-certificates for TLS (Alchemy WS/HTTP,
# R2 metadata fetch, ETH/USD source).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app

# Gate-7 metrics (9464, M2-12) + Ponder web server (/health,/ready,GraphQL, 42069).
EXPOSE 9464 42069
USER node

# Image-level default (host-agnostic — works without compose). Probes Ponder
# /health (200 once the process is up; /ready is deliberately NOT used so a long
# backfill never marks the container unhealthy — readiness is surfaced via the
# gate-7 metrics instead). Compose/orchestrator healthchecks override this.
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=40s \
  CMD curl -sf "http://localhost:${PONDER_PORT:-42069}/health" || exit 1

# Startup = idempotent offchain `migrate` (creates the watermarks / eth_usd /
# metadata_verifications sidecar tables, applies the pg_trgm GIN indexes once the
# Ponder tables exist, and runs the fail-closed runtime asserts: pg_trgm present +
# RPC chain id == 4663) → then `ponder start`. Ponder resumes from its checkpoint
# in the same DATABASE_SCHEMA on restart.
CMD ["/bin/sh", "-c", "bun run scripts/migrate.ts && exec node_modules/.bin/ponder start --hostname 0.0.0.0 --port ${PONDER_PORT:-42069}"]
