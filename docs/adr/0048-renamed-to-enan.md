# ADR 0048 — The product is named Enan

**Status:** accepted (2026-10-22). Supersedes the `X-Requested-With` value of ADR 0005 and the database location of ADR 0029; the rest of both stand.

## Context

The product was built as ExecutiveOS and is published as Enan (عِنان, the rein). The name still appeared in the interface, the docs, the image's data paths, the database file name and the request header. At least one install holds real data under the old paths.

## Decision

- The interface, docs, tests, package name and API title say Enan; the Arabic interface says عِنان.
- State-changing requests carry `X-Requested-With: Enan` (was `ExecutiveOS`). The browser client and the origin check change together.
- The image keeps its data under `/var/lib/enan` (was `/var/lib/executiveos`), and the database file is `enan.db` (was `executiveos.db`); the container user is `enan`, with the same uid 1001. The Compose volumes keep their names, so they mount at the new path with their contents.
- On first open, `enan.db` takes over an `executiveos.db` in the same directory, with its `-wal` and `-shm` files (`ADMIN-B50`). An existing `enan.db` is never replaced.
- The deploy job (ADR 0039) rewrites `/var/lib/executiveos` to `/var/lib/enan` in the server's untracked overlay before it starts the new image, so a volume the overlay mounted at the old path, such as the database volume from the move to SQLite, mounts where the image now looks. The rewrite changes nothing once done.
- The key that encrypts saved AI credentials is still derived with the salt `ExecutiveOS`, so keys saved before the rename still decrypt.
- Accepted ADRs and `docs/history/` keep the old name, as records.

## Consequences

- An install updated through Compose with `git pull` in the folder it was installed from keeps its database, files and backups with no manual step. Compose names the volumes after that folder, so a clone in a new folder starts with new, empty volumes while the data stays in the old ones.
- An install that set its own `DATABASE_URL` keeps using that path unchanged.
- A browser tab opened before the update sends the old header and is refused until it reloads.
- Anything outside this repository that names the old paths stops working until it is updated. The server's nightly export (`scripts/vps-export-backup.sh` in the blog repository) is one; it now reads the paths from the container.
