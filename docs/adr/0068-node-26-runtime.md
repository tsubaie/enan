# ADR 0068 — Node 26 is the runtime

**Status:** accepted (2026-11-01). Refines ADR 0029: the image it names, `node:22-bookworm-slim`, is now `node:26-bookworm-slim`.

## Context

Enan ran on Node 22, pinned in `engines` (`<23`), `.nvmrc`, `.mise.toml`, the CI setup, both Dockerfile stages and the esbuild target, and Dependabot ignored `@types/node` 23 and above so the types could not run ahead of the runtime. Node 22 leaves maintenance on 30 April 2027, after which it gets no security fixes. Node 26 entered active LTS in October 2026 and is maintained until April 2029.

Node 25 stopped bundling corepack, which the Dockerfile used to install pnpm and to put `pnpm` on the runtime image's path.

## Decision

- **Node 26 everywhere the runtime is named:** `engines` `>=26.13.0 <27`, `.nvmrc`, `.mise.toml`, every `setup-node` step, both Dockerfile stages (`node:26-bookworm-slim`) and the standalone bundle's esbuild target (`node26`).
- **`@types/node` follows the runtime's major**, now 26; Dependabot ignores 27 and above.
- **Corepack comes from npm** in the image's base stage, pinned, and the runtime stage copies it beside the pnpm it prepared, so `pnpm` in the container works as before. CI keeps `pnpm/action-setup` and needs no corepack.

## Consequences

- Contributors install corepack themselves (`npm install -g corepack`), as README and CONTRIBUTING say.
- The SQLite file, its migrations and backups do not depend on the Node version, so an updater rollback (ADR 0050, ADR 0057) to a Node 22 image still starts on a database this image migrated.
- The runtime image grows by about 4% (539 MB to 563 MB measured locally).
- Verified before acceptance: `pnpm audit:all` on Node 26.13.0 (typecheck with no source change, 1320 unit and integration tests, 308 browser tests, bundle, OpenAPI, accessibility and performance audits) and `scripts/build/smoke-image.sh` on the image (health, `db:migrate`, `backup:create`, `backup:restore`).

## Alternatives considered

- **Stay on Node 22 until its end of life.** Defers the same change to a deadline, under pressure. Rejected.
- **Node 24.** Still bundles corepack, so the Dockerfile would not change, but its maintenance ends in April 2028, a year before Node 26's, and the move would come round again sooner. Rejected.
- **Install pnpm with `npm install -g pnpm` instead of corepack.** Works, but changes how the image and the `packageManager` field relate and the runtime's `pnpm` link; keeping corepack is the smaller change. Rejected.
