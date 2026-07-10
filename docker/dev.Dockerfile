# ROBBED_ dev-mode runtime image (docker-compose dev services).
# One image for every workspace app: node 22 (next/ponder CLIs), bun (API + WS
# runtime, CLAUDE.md §8/§9), pnpm via corepack (workspace package manager —
# version pinned by root package.json `packageManager`, not here).
# Source is bind-mounted at /workspace; node_modules live in named volumes so
# linux-native binaries (sharp, resvg) never collide with the macOS host install.
FROM node:22-bookworm-slim

# bun from the official image (multi-stage copy — no curl|bash at build time).
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /workspace
