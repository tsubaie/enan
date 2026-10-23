# ADR 0059 — The updater and Enan act on events, not polls

**Status:** accepted (2026-10-23). Amends ADR 0051 and ADR 0057: how often things are checked, not what is done.

## Context

The updater read its commands folder every 30 seconds, asked the registry for a new release every 15 minutes, and Enan turned the updater's outcomes into notifications every 5 minutes, while Admin → Updates refreshed every 5 seconds. Most of these runs find nothing, and a click on Check now could wait half a minute before anything happened.

## Decision

- **Commands are pushed.** The updater watches its commands folder (inotify on Linux) and acts on a command as soon as it is renamed in. Only where the folder cannot be watched does it read it every `ENAN_COMMAND_POLL` (now 5 minutes).
- **Releases are looked for once a day** (`ENAN_UPDATE_INTERVAL` default `24h`), at start and on Check now. A self-hosted install has no inbound connection and there is no central server to tell it, so a new release cannot be pushed to it; releases come monthly at most, so a day is soon enough.
- **Notifications follow the updater's status.** Enan watches `UPDATER_STATUS_DIR` (`fs.watch`) and queues one `users.updates` run shortly after `status.json` changes. The schedule from migration 0008 becomes daily (migration 0015): a safety net for a missed change, and what notices an updater that stopped.
- **The Updates page refreshes only while something is happening:** while the status says checking or updating, or after a click until the updater's status changes (at most a minute). Otherwise it does not refresh.

## Consequences

- The "updater stopped" alert keeps its rule of three intervals and five minutes, so with a daily interval it comes after about three days, and is noticed by the daily run.
- A release is announced up to a day after it is published, unless an administrator presses Check now.
- An install that sets `ENAN_UPDATE_INTERVAL` in `.env` keeps its own value.

## Alternatives considered

- **A shorter command poll (2 seconds).** Still polling, and constant work for a click a month.
- **A quiet "alive" timestamp from the updater** to notice a stop sooner. Periodic too; left until an administrator needs it.
