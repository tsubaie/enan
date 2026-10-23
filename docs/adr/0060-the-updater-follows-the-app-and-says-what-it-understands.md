# ADR 0060 — The updater follows the app's channel and says what it understands

**Status:** accepted (2026-10-23). Amends ADR 0051: the updater still never replaces itself.

## Context

On 2026-10-23 production ran the app on `edge` and the updater on `latest`, the default. No release had been made, so `latest` never moved: each merge installed a new app, while the updater stayed at a build from before announce mode (ADR 0057). Its check for a newer updater looks only under its own tag, so it raised nothing. For a few hours Admin → Updates showed automatic installing as off while that updater installed every build, and Install now and the automatic setting were ignored as unknown commands. Nothing broke, but nothing said the two had drifted apart.

## Decision

- **The updater image follows the app's channel.** `docker-compose.yml` takes `ENAN_UPDATER_TAG`, else `ENAN_CHANNEL`, else `ENAN_TAG`, else `latest`. Every channel tag is published for both images. `.env.example` leaves `ENAN_UPDATER_TAG` empty, so a copied `.env` does not pin it. The existing "newer updater" check then looks where the app's updates come from.
- **The updater says what it understands.** Every `status.json` carries `protocol`, a number raised whenever Enan starts relying on something new the updater does (`updater.Protocol` in Go, `updaterProtocol` in the app). Version 1 is announce mode, Install now, the automatic setting and acting on events (ADR 0059). An updater from before has none, which reads as 0.
- **Enan says when the updater is too old for it** (ADMIN-B69). Admin → Updates shows a warning with the command that replaces the updater, and hides Install now and the automatic setting, which an older updater ignores. Every active administrator is notified once per start of Enan (`update.updater_outdated`), because a new release of Enan is when an updater can fall behind.

## Consequences

- Drift between the two is visible as soon as the new app starts, on any channel and with any `.env`.
- Replacing the updater stays a person's job: one command, given on the page and in the notification.
- A release whose app needs a higher protocol must ship the updater that has it, under the same tags (it does: both are built from the same commit).
- An install still on an updater from before this ADR, on `latest`, holds the first calendar release back as a major-version jump. Its own updater reports the newer updater once the release is out, and the release notes say to replace it first.

## Alternatives considered

- **The updater replaces itself** through a helper container that pulls, recreates, verifies and rolls back. It removes the manual step, but the one part that can repair the others would then replace itself, which ADR 0051 rejected; and it is as much work as the app's install cycle. Left until replacing it by hand proves to be a chore.
- **Comparing versions instead of a protocol number.** The app and the updater are released together, but a version says nothing about which requests an updater knows, and `edge` builds have no version of their own.
- **Shipping the compose file in the image and warning on a difference.** Compose changes are rare and listed in the release notes.
