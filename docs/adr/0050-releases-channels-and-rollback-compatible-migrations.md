# ADR 0050 — Releases, channel tags, and migrations the previous release can run on

**Status:** accepted (2026-10-22). Changes which tags ADR 0039's image job publishes; the deploy job itself is unchanged.

## Context

An install could not tell which version it runs or whether a newer one exists. `package.json` said `0.1.0` forever, nothing was tagged, and `/api/v1/health` reported that constant. CI pushed `:latest` from every merge to main *before* the image's smoke test ran, so a broken image could be `latest` for the length of a run.

Updating an install automatically (#49) needs three things the repository did not provide: an immutable image per commit, channel tags that only ever point at an image that passed every check, and a way back. The cheapest way back is to start the previous image again. That works only if the previous release can run on a database the new one migrated. Nothing guaranteed it: migration 0001, for example, renamed a column the release before it reads.

## Decision

- **Every commit of main has an immutable image, `:<sha>`.** It is the only tag the image job pushes.
- **Channel tags move only after the gate.** The `publish` job moves `:edge` to a commit once its gate passed. Pushing a tag `vX.Y.Z` on a checked commit of main runs `release.yml`. That workflow refuses a tag whose commit is not on main, whose gate has not passed, or whose number differs from `package.json`. It then points `:X.Y.Z`, `:X.Y`, `:X` and `:latest` at that commit's image, without rebuilding it, and creates the GitHub Release. A pre-release (`-rc.1`) gets its own tag only.
- **The image says what it is.** `/api/v1/health` reports `version` and `revision` (the commit, from `ENAN_REVISION`, set at build). Images carry `org.opencontainers.image.version` and `.revision`, plus `org.enan.schema` (how many migrations the image applies) and `org.enan.contract` (the position of its newest migration the previous release cannot run on, 0 for none).
- **Migrations are expand/contract.** A migration must leave the database usable by the previous image: add first, and drop, rename or tighten a release later. `audit:migrations` rejects a destructive statement (`DROP TABLE`, `DROP COLUMN`, `RENAME`, `DROP INDEX`, `DROP VIEW`, `DROP TRIGGER`) unless the file declares one of two things:
  - `-- enan:contract`: it breaks the previous release. The image's `org.enan.contract` names it.
  - `-- enan:compatible <why>`: it looks destructive but is not, for example a table rebuild that keeps every column and constraint the previous release relies on.
- **Going back from image C to image R is safe exactly when `C.contract <= R.schema`.** An updater never rolls back across a contract migration, and never installs one unless the operator allows it. CI proves the rule for every image: it starts the image on a fresh database, then starts the current `:edge` on the database it migrated, and requires both to be healthy, unless the labels say a rollback across this image is unsupported.
- **Baseline.** Migrations 0000 to 0006 predate the rule and are not checked.

## Consequences

- `:latest` means the newest release, not the newest commit. Until the first release after this ADR, it is the last image pushed under the old rule. Installs that want every merge use `:edge`.
- Releasing is two steps: a pull request that bumps `package.json`, then a tag on the merged commit (CONTRIBUTING.md § Releasing).
- Removing or renaming a column takes two releases. A contract migration is allowed, but it is visible: in the audit, in the image labels and in the release notes.
- The deploy job keeps deploying `:<sha>` and is untouched; a pull-based updater replaces it later (#49).

## Alternatives considered

- **Restore the backup on rollback.** It silently discards everything written since the backup, and an updater cannot judge schema compatibility on its own. Rejected for automatic use; restoring stays a person's decision.
- **Run the previous release's tests against the new schema.** Stronger, but it needs the previous release's source and test database in every run. Starting the previous image on the migrated database catches what matters for a rollback (it starts, migrates nothing, and answers health) at a fraction of the cost.
