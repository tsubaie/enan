# ADR 0052 — The push deploy is removed; the maintainer's install updates itself

**Status:** accepted (2026-10-22). Supersedes the deployment parts of ADR 0039 and ADR 0040; their CI decisions stand.

## Context

ADR 0039 had CI deploy every merge to `main` by logging into the maintainer's server over SSH. ADR 0040 made that opt-in and moved the server's details into a `production` environment's secrets. ADR 0051 added an updater service that installs keep running themselves: it pulls the newest image of a channel, backs up, switches, verifies and rolls the image back. With it, the push deploy did the same job a second way, and kept a key that can log into a production server stored in GitHub.

## Decision

- **The `deploy` job is deleted** from `.github/workflows/ci.yml`. CI publishes images and moves channel tags (ADR 0050) and reaches no server.
- **The maintainer's install runs the updater on the `edge` channel**, like any self-hosted install that wants every checked commit of `main`. Its app image is `ghcr.io/tsubaie/enan:edge` in its untracked overlay.
- **The repository holds no deployment credential:** the `production` environment with its `DEPLOY_*` secrets and the `DEPLOY_ENABLED` variable are deleted, and the server's deploy key is removed from its `authorized_keys`.

## Consequences

- A merge reaches the maintainer's install within one updater interval after its gate passes, not seconds after.
- A failed update no longer turns a GitHub job red. It is rolled back on the server and reported on Admin → Updates, as an Enan notification and to `ENAN_ALERT_WEBHOOK` (ADR 0051).
- Compose file changes reach the server when the operator runs `git pull` and `docker compose up -d` there; the updater replaces the app container only.
