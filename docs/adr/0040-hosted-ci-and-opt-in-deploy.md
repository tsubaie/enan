# ADR 0040 — CI on GitHub's hosted runners; deployment is opt-in and configured outside the code

**Status:** accepted (2026-10-19). Amends ADR 0039.

## Context

The repository is public. In a public repository, a pull request from a fork runs its own code on whatever runner the workflow names, so a self-hosted runner shared with anything else is exposed to anyone who opens a pull request. The deploy job also named one server, its user and its paths in the workflow, which a fork or a fresh clone would inherit.

## Decision

- **Every CI job runs on `ubuntu-latest`.** The repository variable `CI_RUNS_ON` can still send a run elsewhere, for example to a dedicated runner.
- **Caches replace a warm disk:** pnpm's store, Next's `.next/cache` and Docker's layer cache (`type=gha`, written only by `main`) come from GitHub's cache service.
- **The image is `ghcr.io/<owner>/<repository>`**, built natively for `linux/amd64`.
- **Deployment is opt-in.** The `deploy` job runs on a push to `main` only when the repository variable `DEPLOY_ENABLED` is `true`. The job runs in the GitHub environment `production`, which admits only `main`. The server comes from that environment's secrets, which the public logs mask: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_DIR` (the server's checkout of this repository) and `DEPLOY_OVERLAY` (the untracked compose overlay there that names the image). The app container is found through `docker compose ps -q app`, not by name. Everything else in ADR 0039 stands: backup first, health check, automatic rollback.

## Consequences

- Forks and fresh clones run the checks but never try to deploy, and no branch but `main` can read the deploy secrets.
- A run starts cold apart from what the caches restore, so it can be slower than a long-lived runner.
- Nothing about the maintainer's server is in the repository.
