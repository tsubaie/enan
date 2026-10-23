# ADR 0056 — Calendar versions, published by a workflow

**Status:** accepted (2026-10-23). Supersedes the version numbering and the two-step manual release of ADR 0050, and the major-version guard of ADR 0051. Channel tags, the gate before a tag moves, and expand/contract migrations stand.

## Context

Versions were Semantic Versioning (`0.1.0`) and changed only when a maintainer edited `package.json`, merged it and pushed a tag (ADR 0050). Every release meant deciding "patch, minor or major?", and the number told an office nothing about how recent its install is. The updater (ADR 0051) held back a new major version until `ENAN_ALLOW_MAJOR`, a guard that duplicated the one that matters: whether the previous release can run on the migrated database (`org.enan.contract`).

## Decision

- **Calendar versions, `YYYY.M.N`.** The year, the month without a leading zero, and a counter within the month from 0: `2026.10.0`, `2026.10.1`, `2026.11.0`. It is valid SemVer, so `package.json`, the image labels and `sort -V` keep working. The first is `2026.10.0`, after `v0.1.0`. `release.yml` accepts only `vYYYY.M.N` (and pre-releases of it) and publishes `:YYYY.M.N`, `:YYYY.M`, `:YYYY` and `:latest`.
- **A workflow prepares each release, run by hand.** `prepare-release.yml` (`workflow_dispatch` only, no schedule) computes the next version from the date in UTC and the existing tags (`scripts/build/release-version.ts`), and stops when nothing merged since the last release. It opens a pull request that bumps `package.json`, merges it once the Gate passes, waits for the Gate on the merge commit, and pushes the tag, which runs `release.yml` as before.
- **The bump goes through a pull request, not an admin bypass.** The ruleset on `main` stays as it is and the bump is checked like any change. The workflow merges the pull request itself once the Gate passes, so the repository needs no auto-merge setting. It uses a fine-grained token (`RELEASE_TOKEN`, Contents and Pull requests), because a pull request or tag pushed with `GITHUB_TOKEN` starts no workflow.
- **The updater's major-version guard is removed**, with `ENAN_ALLOW_MAJOR`. With calendar versions, the first number is the year, and every January would be held. The contract guard (`ENAN_ALLOW_CONTRACT`) and the refusal to install an image that cannot read the database stand.

## Consequences

- An office reads its install's age from the version. Installs may pin a year (`2026`) or a month (`2026.10`) as their channel.
- A version says nothing about compatibility. What breaks a rollback is in the image labels and the release notes, as before.
- The bump is still a commit on `main`, because the image's version comes from `package.json` at build time and the updater checks it against `/api/v1/health`.
- A release takes two Gate runs, one on the pull request and one on `main`.
- `ENAN_ALLOW_MAJOR` left in an install's `.env` is ignored.

## Alternatives considered

- **Keep SemVer.** Rejected for the reasons above; nothing in Enan uses the major number as an API promise.
- **Push the bump with an admin-bypass token.** Faster, but the commit skips the pull request's Gate and needs a token able to bypass the ruleset.
- **A monthly schedule.** Rejected for now: a release stays a maintainer's decision, and the workflow makes it one click.
- **Derive the version from the tag at build time.** The image is built once per commit, before any tag exists, and is never rebuilt for a release (ADR 0050).
