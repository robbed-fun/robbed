# ROBBED_ dev-mode runtime image (docker-compose dev services).
# One image for every workspace app: node 22 (next/ponder CLIs), bun (API + WS
# runtime, CLAUDE.md), pnpm via corepack (workspace package manager —
# version pinned by root package.json `packageManager`, not here).
# Source is bind-mounted at /workspace; node_modules live in named volumes so
# linux-native binaries (sharp, resvg) never collide with the macOS host install.
FROM node:22-bookworm-slim

# bun from the official image (multi-stage copy — no curl|bash at build time).
# python3/make/g++: node-gyp toolchain for approved native build scripts
# (root package.json pnpm.onlyBuiltDependencies). `keccak` (transitive via
# @coinbase/wallet-sdk) ships NO linux-arm64 prebuild, so on Apple-Silicon
# Docker a fresh `pnpm install` must compile it — without the toolchain the
# `deps` one-shot fails (observed 2026-07-12 after a volume wipe).
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /workspace
