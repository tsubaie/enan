# ADR 0044 — The runtime image is the standalone output

**Status:** accepted (2026-10-21)

## Context

The runtime image copied every production package (588 MB of `node_modules`) next to Next's standalone output, plus `src`, `scripts`, `tests/fixtures` and `tsconfig.json`. The server needs none of it: `.next/standalone` already carries the files its build traced. They were there because the container runs `db:migrate`, `backup:create` and `backup:restore` with `tsx`, straight from the TypeScript source. Most of those 588 MB are never loaded at runtime: the full `next` package (about 200 MB), its compiler binary (93 MB) and every `lucide-react` icon (45 MB).

## Decision

- **The runtime stage copies `.next/standalone` and nothing else.** Its traced `node_modules` is its own layer, so it is reused until the lockfile changes.
- **The three container commands are bundled at build time** by `scripts/build/assemble-standalone.ts` with esbuild, into `commands/*.mjs` inside the standalone output. The packages the standalone output keeps in `node_modules` (`argon2`, `@libsql/client`, `sharp`, and `pino`, which starts workers from its own files) stay external; everything else is inlined. They resolve with the `react-server` condition, as the server does.
- **The commands keep their names.** The standalone `package.json` is rewritten with `db:migrate`, `backup:create` and `backup:restore` scripts that run the bundles, so `docker compose exec app pnpm backup:create` works as before (ADMIN-B13).
- **CI runs the image on pull requests too**: health after the start-up migrations, then the three commands, then health again.

## Consequences

- The image drops the dev and production installs, `tsx`, the source tree and the fixtures; it no longer contains source code.
- A command the container should run must be added to `commands` in the build script. Running any other script needs a development checkout or the `development` stage.
- If one of the commands starts importing a package that is neither traced by Next nor bundleable (a native addon, or something that loads files at runtime), the build script's `external` list and the standalone trace must both cover it; the CI smoke test fails otherwise.
