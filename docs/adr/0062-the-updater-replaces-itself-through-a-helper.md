# ADR 0062 — The updater replaces itself through a helper

**Status:** accepted (2026-10-23). Supersedes, in ADR 0051, "the updater never replaces itself"; ADR 0060's warning for an updater too old for Enan stays.

## Context

ADR 0051 kept the updater from replacing itself: a program that swaps itself out has nothing left to put things back if the new copy is broken. So a newer updater was announced and an operator ran two commands on the server. In practice that meant a terminal visit after every change to the updater, and, since every commit rebuilt its image, an announcement after every merge whether the updater had changed or not. Administrators of a self-hosted install should not need a terminal to keep it current.

## Decision

- **One press, or automatic.** Administration → Updates offers **Update the updater** when a newer updater is out (`update_updater`); with automatic installing on, the updater does it by itself inside the install window. A newer updater whose replacement failed is not tried again by itself; asking again, or Try again, does.
- **A helper does the swap.** The running updater pulls the newer image, points the reference compose names at it, and starts a short-lived helper from that image (`enan-updater replace <id>`, no restart policy, removed by Docker on exit, outside the compose project), then takes no more work. The helper stops the running updater, which frees its lock, sets it aside under a suffixed name, and creates the new updater with the old one's settings, recreated as the app is (ADR 0057). It keeps the new one once it writes a fresh status within `ENAN_HEALTH_TIMEOUT`, and removes the old one; otherwise it removes the new one, writes why to the status folder and starts the old one again, which records the failure on start.
- **A broken image changes nothing.** The helper is the new image: if it cannot even start, the old updater was never stopped and carries on.
- **Newer means other source.** CI labels each updater image with a fingerprint of `updater/` (`org.enan.updater.source`); an image with the running one's fingerprint is not newer, so a rebuild for an app-only commit announces nothing.
- **Protocol 2.** The updater says it can replace itself (ADR 0060); Enan offers the button only then, and the server commands to an older updater, once.

## Consequences

- No terminal visit to keep the updater current, from the first updater with protocol 2 on.
- A helper that dies mid-swap (the machine loses power) can leave the updater set aside and stopped; `docker compose up -d` starts the updater again. Every step before the swap leaves the running updater untouched.
- As with the app (ADR 0057), the next `docker compose up` after a replacement recreates the updater once, on the same image.

## Alternatives considered

- **Keep the commands.** Safe, but every install needs a terminal, and most never visit one.
- **The updater recreates itself in place.** Stopping itself ends the process that would verify the new one; nothing could put it back.
- **A second, permanent supervisor service.** Another container with the Docker socket, and the same question of who updates it.
