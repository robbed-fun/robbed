# syntax=docker/dockerfile:1
#
# ROBBED_ API image — Hono on Bun (spec §8/§9: "Bun stays the runtime"). ONE image
# serves BOTH entrypoints so the WS fanout is co-located with the HTTP API + Redis
# (spec §8 <500ms budget): the compose runs two services from this image — the
# default CMD is the HTTP API (src/index.ts); the `ws` service overrides `command`
# to run the fanout (src/ws.ts). (Alternatively build a dedicated WS image with
# `--build-arg APP_ENTRY=src/ws.ts`.)
#
# Build context = REPO ROOT (workspace `workspace:*` + lockfile):
#   docker build -f apps/api/Dockerfile -t robbed-api .
#
# Docs-first (2026-07-10):
#   - deploy-komodo-cloudflare.md A.5: install with pnpm (strict node_modules,
#     no phantom deps), run with Bun; base `oven/bun:1.3.14` (toolchain pin).
#   - pnpm.io/docker + pnpm.io/cli/deploy: `pnpm deploy --legacy --prod` yields a
#     self-contained folder with a REAL node_modules (native sharp / @resvg/resvg-js
#     built for linux-glibc) that Bun then runs — avoids pnpm's virtual-store
#     symlinks crossing the stage boundary. Build + run stages are both bookworm
#     (glibc) so the prebuilt native binaries are ABI-compatible.
#   - bun.com Docker guide: multi-stage, run as the non-root `bun` user.

# ── build: Node 22 + pnpm does the install (strict), NOT the runtime ──────────
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm/bin:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
# All workspace manifests (so --frozen-lockfile matches the lockfile graph); the
# --filter narrows the actual install to @robbed/api + @robbed/shared.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json         apps/api/package.json
COPY apps/indexer/package.json     apps/indexer/package.json
COPY apps/web/package.json         apps/web/package.json
COPY packages/shared/package.json  packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @robbed/api...
COPY packages/shared  packages/shared
COPY apps/api          apps/api
# Self-contained prod bundle at /out (real node_modules incl. platform-native
# sharp/@resvg for OG rendering; src/, migrations/, openapi.yaml preserved).
RUN pnpm --filter @robbed/api --prod --legacy deploy /out

# ── runtime: Bun (the API + WS runtime, spec §8/§9) ───────────────────────────
FROM oven/bun:1.3.14 AS runtime
# curl for the compose healthchecks; ca-certificates for TLS (R2 uploads, RPC).
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=bun:bun /out /app

# Which entrypoint this image defaults to. Override per-service via compose
# `command:` (preferred, one image / two services) or bake a WS-only image with
# `--build-arg APP_ENTRY=src/ws.ts`.
ARG APP_ENTRY=src/index.ts
ENV APP_ENTRY=${APP_ENTRY}

# HTTP API (API_PORT, default 3001) + WS fanout (WS_PORT, default 3002).
EXPOSE 3001 3002
USER bun

# CMD (not ENTRYPOINT) so a compose `command:` cleanly replaces it for the ws service.
CMD ["/bin/sh", "-c", "exec bun run \"$APP_ENTRY\""]
