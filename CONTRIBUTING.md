# Contributing to Enan

Thank you for helping. This project is built to be extended module by module, so most contributions follow the same path.

## Before you start

- Read `AGENTS.md`, then `docs/README.md` in the order it lists. The documents under `docs/` are the specification; `docs/07-coding-guidelines.md` is enforced by lint, the audit scripts and review.
- Every behavior has a requirement ID (`TASKS-B03`, `EP-A02`). Work items name the IDs they implement, and every implemented ID has a scenario whose test name contains it.
- Branch names: `feat/<module>-<slug>`, `fix/<module>-<slug>`, `chore/<slug>`, `docs/<slug>`. Never commit to `main`.

## Setting up

Node 22 and pnpm 10 (`corepack enable`). Copy `.env.example` to `.env` for the Docker stack, and for tests (no database server; the suite uses a SQLite file under `tmp/` whose name ends in `_test.db`):

```bash
cp .env.test.example .env.test
pnpm install
pnpm test
```

See the Development section of `README.md` for the browser suite and the full gate.

## The gate

`pnpm audit:all` must pass before a pull request is opened. It runs lint, types, the dependency graph, thirteen audit scripts, the unit and integration suites, the production build, the browser suite, and the accessibility and performance checks. Locally it needs the `gitleaks` binary and a production build; CI installs both. The gate is grouped into `audit:static`, `audit:data` and `audit:browser`, which CI runs as parallel jobs; run a single group while iterating and `audit:all` before you open the pull request.

If an audit fails on something the docs did not anticipate, fix the code or fix the document in the same pull request. Never weaken a rule to get green.

## Adding a module

1. Create `src/modules/<name>/` with the manifest entries listed in `docs/02-architecture.md` § Module manifest, and `docs/features/<name>.md` from `docs/templates/feature-spec.md`.
2. Register it in `src/core/modules/client.ts` (navigation) and `src/core/modules/registry.ts` (home sections, job kinds). Nothing else lists modules.
3. Build lists with `EntityPage` (`src/ui/entity`), data access with the helpers in `src/core/db/entity.ts` and `src/core/db/keyset.ts`, and settings through `getSetting`.
4. Add `en` and `ar` messages together; render dates and counts through `src/ui/format.ts`.

## Pull requests

Use the pull request template: requirement → scenario table, spec sections changed, `pnpm audit:all` summary, and recorded assumptions. One logical change per pull request; keep it under 800 lines unless the description says why.

## Migrations

A migration must leave the database usable by the release before it (ADR 0050), because rolling back an update means starting the previous image on the database the new one migrated. Add tables, columns and indexes freely; drop, rename or tighten them a release later. `audit:migrations` rejects a destructive statement unless the file says which case it is:

- `-- enan:contract`: the previous release cannot run on this. The image is labelled, the release notes say so, and an updater never rolls back across it.
- `-- enan:compatible <why>`: it only looks destructive, for example a table rebuild that keeps every column and constraint.

## Releasing

Maintainers only. Versions are calendar versions, `YYYY.M.N`: the year, the month without a leading zero, and a counter within the month from 0, for example `2026.10.0`, `2026.10.1`, `2026.11.0` ([ADR 0056](docs/adr/0056-calendar-versions-published-by-a-workflow.md)).

Run **Actions → Prepare release → Run workflow** (or `gh workflow run prepare-release.yml`). It:

1. computes the next version from today's date (UTC) and the existing tags, and stops if nothing merged since the last release;
2. opens a pull request that sets `version` in `package.json`, and merges it once its Gate passes;
3. waits for the Gate on the merge commit, then tags it `vYYYY.M.N` and pushes the tag.

The workflow needs the repository secret `RELEASE_TOKEN`, a fine-grained token on this repository with Contents and Pull requests read and write. A pull request or tag pushed with the built-in `GITHUB_TOKEN` starts no workflow, so neither the Gate nor `release.yml` would run.

`release.yml` then checks that the tag is `vYYYY.M.N`, that the commit is on main, that its gate passed and that `package.json` agrees with the tag. It builds a linux/arm64 image of the same commit on an ARM runner and smoke-tests it there ([ADR 0058](docs/adr/0058-releases-add-arm-images.md)), then points `:2026.10.0`, `:2026.10`, `:2026` and `:latest` at the linux/amd64 image CI already built and tested for that commit together with that ARM image, and creates the GitHub Release with generated notes. A pre-release (`v2026.10.0-rc.1`, tagged by hand) gets its own tag only. Every merge to main also moves `:edge` once its gate has passed.
