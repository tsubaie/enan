# ADR 0051 — Installs update themselves through an opt-in updater service

**Status:** accepted (2026-10-22). Builds on ADR 0050. The deploy job of ADR 0039 stays until the maintainer's install has moved to the updater (#54), and is then removed by a later ADR.

## Context

An install learns about a new version only by watching the repository, and updating is a manual `pull` and `up`. The maintainer's own install is updated differently: CI logs into the server over SSH, which keeps a credential able to reach a production server in GitHub and gives self-hosters nothing. ADR 0050 made every commit an immutable image, made channel tags trustworthy and made rolling back the image safe by default. This ADR uses them.

## Decision

- **Pull, not push.** An `updater` service in `docker-compose.yml`, off unless started with `--profile autoupdate`, checks the app's channel every `ENAN_UPDATE_INTERVAL` (default 15 minutes), optionally only inside `ENAN_UPDATE_WINDOW`. The channel is the tag the app runs (`ENAN_TAG`), or `ENAN_CHANNEL`. GitHub never reaches the server.
- **Go, standard library only.** The cycle is a state machine that must survive being stopped at any step and must be unit-tested; a shell script is neither. Go gives a 10 MB static image on `scratch` and talks to the Docker Engine API and the registry with `net/http` alone. No third-party module, so `govulncheck` covers the toolchain.
- **One cycle.**
  1. Resolve the channel tag to a digest. The same digest as the running image ends the cycle.
  2. Pull by digest.
  3. **Guard**: a new major version waits for `ENAN_ALLOW_MAJOR`. An image whose `org.enan.contract` exceeds the running image's `org.enan.schema` waits for `ENAN_ALLOW_CONTRACT`, because the release before it could not run on its database (ADR 0050).
  4. **Back up** with the app's own `pnpm backup:create`. No backup, no update.
  5. **Switch**: tag the new image with the name compose uses, stop the app and rename it (it is kept), create the new container from the old one's settings, and start it. Settings the old image supplied are dropped so that the new image supplies its own. Compose's labels are kept, and its image label is rewritten, so a later `docker compose up` sees nothing to change.
  6. **Verify**: within `ENAN_HEALTH_TIMEOUT`, the container is healthy and `/api/v1/health` reports the new image's version **and** revision. A container from an old image that is still answering does not pass.
  7. **Roll back the image only.** Remove the new container, rename the old one back and start it. **The database is never restored automatically.** The status names the backup and the exact restore command, and a person decides. An image that failed is not retried until `enan-updater retry`.
- **State on disk.** The phase is written before each transition. On start, an update interrupted after the switch is verified and finished, and any other interrupted update is reversed.
- **Status and commands are separate volumes.** `updater-status` (`status.json`, `history.jsonl`) is written only by the updater. `updater-commands` is where the CLI, and later Enan (#53), leave `check`, `pause`, `resume`, `retry` and `rollback` requests. The app never gets the Docker socket and starts no subprocess (ADR 0029).
- **Alerts do not depend on Enan.** `ENAN_ALERT_WEBHOOK` receives a JSON POST for every outcome except a quiet check. It carries a one-line `text` (Slack's format) and the full status. The container's `HEALTHCHECK` turns unhealthy when checks stop.
- **The updater does not replace itself.** It reports a newer updater image once (status and webhook), and the operator pulls and restarts it.
- **Released with the app.** The updater image is `ghcr.io/tsubaie/enan-updater`, built and tested in CI, published as `:<sha>`. It moves to `:edge` and to the release tags together with the app's.

## Consequences

- The Docker socket is root-equivalent on the host. It is mounted only into the updater, which listens on no port and talks only to the registry and the webhook. That is a smaller exposure than a root SSH key stored in GitHub.
- Only public images are supported: the registry is queried anonymously.
- The updater recreates the app container through the Engine API rather than by running compose. A compose file changed by `git pull` takes effect on the operator's next `docker compose up`, not through the updater.
- An install whose app is not run by compose names its container with `ENAN_APP_CONTAINER`.

## Alternatives considered

- **Watchtower.** Unmaintained, and it has neither a backup before migrations nor a version-checked rollback.
- **Running `docker compose` inside the updater.** It needs the compose files at the same path inside the container as on the host, and the compose CLI in the image. Recreating through the API needs neither.
- **Rust.** Proposed first. Go was chosen for a standard library that already covers HTTP over a Unix socket and the registry API, and for faster builds.
- **Restoring the backup on rollback.** Rejected in ADR 0050.
