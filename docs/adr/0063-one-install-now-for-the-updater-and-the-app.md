# ADR 0063 — One Install now for the updater and the app

**Status:** accepted (2026-10-23). Amends ADR 0062: the updater replacing itself is no longer a separate action on the page.

## Context

ADR 0062 let the updater replace itself, but as its own card and button beside the app's Install now. An administrator then had two updates to understand and run in the right order, for what is, to them, one product. Which part of Enan is newer is not theirs to know.

## Decision

- **One card, one Install now** for whatever is newer: Enan's release, its updater, or both. With only the updater newer, the card offers a small update and names no release.
- **The updater goes first.** When the updater is newer, Install now keeps the release asked for in the updater's state (`pending`) and replaces the updater (ADR 0062); the new updater installs the release once it runs. The page shows one progress: preparing, backing up, switching, verifying.
- **One outcome.** A replacement that fails installs nothing more: the failure is the outcome of that Install now, and Install now again tries both. A replacement that cannot even start drops the pending release too, so nothing is installed later by surprise.
- **Protocol 3.** An updater of protocol 3 or later takes Install now with no release (`install` without a digest) and installs both; the page keeps the separate updater card for a protocol 2 updater, and the server commands for an older one.

## Consequences

- Administrators see one update. The separate updater card appears only for an updater from before this ADR, until it is replaced.
- Automatic installing keeps installing both by itself, the release first and then the updater, at the check that finds them; the order is not visible to the reader.

## Alternatives considered

- **Two buttons, in a stated order.** Leaves the reader to learn what the updater is and why it comes first.
- **The app first, then the updater.** A newer release may rely on what only the newer updater understands (ADR 0060); the updater first never leaves a release with an updater too old for it.
