# ADR 0039 — A push to main deploys to the server

**Status:** accepted (2026-10-18)

## Context

Production runs on one small x86-64 server. Until now a release was manual: build the image elsewhere, `docker save | ssh … docker load`, edit the image tag in the server's untracked deployment overlay, and restart. CI only built a throwaway image to prove the Dockerfile.

## Decision

- **CI publishes the production image, in the one container image job.** On a pull request that job only proves the Dockerfile builds (natively, nothing published). On a push to `main` the same job builds the `runtime` target for `linux/amd64` on the CI runners and pushes `ghcr.io/<owner>/<repository>:<commit>` and `:latest`, so the image is built once. It never builds on the server.
- **The image is smoke-tested before use:** a fresh SQLite volume, migrations on start, and `/api/v1/health` reporting the database within three minutes.
- **The `deploy` job runs only when the gate passes**, and the gate requires the container image job. Over SSH (host and key from the repository's secrets; ADR 0040 names them) it takes a lock, resets the server checkout to the commit, takes the app's own verified backup from the running version, pulls the image with the job's `GITHUB_TOKEN` (logging out afterwards), points the overlay at it and restarts. Migrations run on start (ADR 0003, ADR 0029).
- **Rollback is automatic for a failed start:** if the container is not healthy within three minutes, the overlay goes back to the previous image, the app restarts on it, and the job fails. The previous image is kept on the server; older ones re-pull from GHCR.
- **A run on `main` is never cancelled by a newer push**, so a deploy is not stopped midway; it waits instead.

## Consequences

- The repository needs the deploy secrets and variables (ADR 0040). Without them nothing on the server changes.
- The server's deployment overlay (untracked) remains the place that names the image; the deploy edits only its `image:` line.
- A migration that succeeds but breaks behaviour is not rolled back automatically: the backup taken before the switch is the way back (`pnpm backup:restore`).
