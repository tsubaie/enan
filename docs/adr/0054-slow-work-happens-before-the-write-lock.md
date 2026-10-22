# ADR 0054 — Slow work happens before the write lock

**Status:** accepted (2026-10-23). Supersedes the third decision of ADR 0045 (AI checks inside write transactions); its other decisions stand.

## Context

ADR 0029 serializes every write in the process. ADR 0045 took slow read-only handlers out of that queue, but kept two waits inside write transactions. `availableCapabilities` awaited a connection that had never been checked, and `loadModels` awaited a catalog it did not have. Both are provider calls with a 10 s timeout. Those waits happen right after a restart, and every time the catalog failed to load before. The wallpaper upload also decoded and resized the image inside the request's transaction, which takes seconds on a small server. It wrote the files before the commit, and the delete removed them before the commit.

## Decision

- **No provider call is awaited inside a write transaction.** With no connection status or catalog yet, admission and the model save start the fetch in the background and answer `ai_unavailable`. Only routes that run with `transaction: false` (AI availability, the AI model list) wait for the provider. The connection status and the catalog are kept once per process on `globalThis`, as the database client's state is.
- **A handler whose slow work comes before its write may run with `transaction: false` when its service opens its own short transaction for the write.** The wallpaper upload decodes and stores both files, then inserts the rows in one transaction and removes the files if that fails. The wallpaper delete removes the files only after its transaction commits. Both services are listed among the exports that own their transaction (ADMIN-B36).
- **Temporary `.partial` files** left by a crash in `FILES_DIR` are removed when the server starts.

## Consequences

- The first AI action after a restart, or after a failed catalog load, may be refused once while the fetch runs. The availability read the UI makes first usually warms the cache.
- A handler marked `transaction: false` that writes does so through its service's own `withTransaction`, which still takes the write queue. Writing on the pool without a transaction remains forbidden.
- A wallpaper upload that loses the race for the last free place is refused after its files were written; they are removed before the error is answered.
