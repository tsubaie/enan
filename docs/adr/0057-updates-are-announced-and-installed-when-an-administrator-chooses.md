# ADR 0057 — Updates are announced by default and installed when an administrator chooses

**Status:** accepted (2026-10-23). Supersedes the opt-in at installation (`--profile autoupdate`), the `ENAN_UPDATE_WINDOW` and `ENAN_ALLOW_CONTRACT` settings, and the always-automatic install of ADR 0051. The cycle itself (pull, back up, switch, verify, roll the image back) stands.

## Context

An install either updated itself, because the operator started the updater with `--profile autoupdate`, or heard nothing at all about new releases. An update can change behaviour an office relies on, so the people running the install should decide when it happens, from inside Enan, where the choice can be seen and changed. The setting was a flag picked once at installation instead.

## Decision

- **Option A: the updater runs on every install, in announce mode by default.** `docker-compose.yml` starts it without a profile. Every `ENAN_UPDATE_INTERVAL` it checks the channel, reads a new release's version and migration labels from the registry (its manifest and config, a few kilobytes, not its layers) and announces it: status `available`, one webhook alert, and one `update.available` notification for every active administrator. Nothing is installed. Option B, where the app checks the registry and the updater stays opt-in, was rejected because one-click install would not work out of the box.
- **Install now** on Admin → Updates leaves an `install` command naming the announced digest. The updater installs exactly that digest with the existing safe cycle, not whatever the channel names by then. A paused updater installs nothing.
- **A release the running one cannot go back from** (`org.enan.contract` above the running `org.enan.schema`, ADR 0050) is no longer held behind an environment variable. The page asks for a confirmation that says it cannot be undone by going back and that a backup is taken first. Without the confirmation, both the app and the updater refuse it. `ENAN_ALLOW_CONTRACT` is removed.
- **Automatic installing is an administrator's setting, off by default**, with an optional daily window in `ENAN_UPDATE_TZ`. It lives in the updater's `state.json`, changed through a `settings` command on the commands volume, so it needs no server access and no restart. The change is written to the audit log. The window limits automatic installs only, and checks run all day. A contract release is never installed automatically.
- **Existing installs keep working as before.** An updater that finds a `state.json` written before this ADR (one that was running with `--profile autoupdate`) records automatic installing as on, once, and keeps `ENAN_UPDATE_WINDOW` as its window. A new install has no state and starts in announce mode.
- **Going without the updater** is `ENAN_UPDATER_REPLICAS=0` in `.env`. The page then says the updater is not running.

## Consequences

- Every install now runs a container holding the Docker socket, which is root-equivalent on the host. It listens on no port and talks only to the registry and the optional webhook. README and SECURITY.md say so, and how to turn it off.
- Nothing is downloaded until a release is installed. Reading labels from the registry is new code in the updater (`registry.Labels`); the image layers are pulled only by Install now or an automatic install.
- A release is read and pulled for the platform of the running app image, so an install that runs an emulated image (linux/amd64 on an ARM Mac) updates too. There, the next `docker compose up` after an update recreates the app container once, on the same new image, because compose records the image differently for an emulated platform; native installs are not recreated.
- The maintainer's install on `edge` stays automatic through the migration rule above (ADR 0052).

## Alternatives considered

- **B: the app asks the registry itself.** No socket by default, but Install now would need the operator to start the updater first, and the app would need registry code the updater already has.
- **Keep the setting in `.env`.** Changing it would need server access and a restart, and it could not be audited.
