# syntax=docker/dockerfile:1.7
FROM ghcr.io/gitleaks/gitleaks:v8.30.1 AS gitleaks
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV COREPACK_HOME=/opt/corepack NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
COPY --from=gitleaks /usr/bin/gitleaks /usr/local/bin/gitleaks

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS development
COPY . .
RUN mkdir -p .next /var/lib/enan/data /var/lib/enan/files /var/lib/enan/backups && chown -R node:node .next /var/lib/enan
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM deps AS builder
# Build workers (next.config.ts): CI passes a small number so parallel builds stay in memory.
ARG NEXT_BUILD_CPUS=
ENV NEXT_BUILD_CPUS=$NEXT_BUILD_CPUS
COPY . .
# .next/cache is never reused inside Docker (.next is in .dockerignore), and keeping it would make
# the CI layer cache save a layer that changes on every push. The standalone output's node_modules
# moves beside it, so the runtime stage can copy it as a layer of its own.
RUN pnpm build && rm -rf .next/cache && mv .next/standalone/node_modules .next/standalone-node_modules

# ADR 0029: the database is one SQLite file on the data volume, so the runtime image is plain
# Node with no database client of any kind.
FROM node:22-bookworm-slim AS runtime
RUN groupadd --gid 1001 enan && useradd --uid 1001 --gid enan --create-home enan
COPY --from=base /opt/corepack /opt/corepack
RUN ln -s ../lib/node_modules/corepack/dist/pnpm.js /usr/local/bin/pnpm
WORKDIR /app
# Only Next's standalone output: the server, the packages its build traced, static files,
# public, drizzle and the bundled commands (scripts/build/assemble-standalone.ts). Its traced
# node_modules changes only with the lockfile, so it is its own layer, before the files every push
# changes: Docker reuses a layer only when nothing above it changed.
COPY --from=builder --chown=enan:enan /app/.next/standalone-node_modules ./node_modules
COPY --from=builder --chown=enan:enan /app/.next/standalone ./
RUN mkdir -p /var/lib/enan/data /var/lib/enan/files /var/lib/enan/backups && chown -R enan:enan /var/lib/enan
USER enan
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 COREPACK_HOME=/opt/corepack NEXT_MANUAL_SIG_HANDLE=true
EXPOSE 3000
ENTRYPOINT []
CMD ["node", "server.js"]
