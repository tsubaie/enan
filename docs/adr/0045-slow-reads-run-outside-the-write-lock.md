# ADR 0045 — Slow read-only handlers run outside the write lock

**Status:** accepted (2026-10-21)

## Context

ADR 0029 puts every API request in one immediate transaction, and every writer in the process waits for its turn in one queue. A few handlers only read, but read slowly. `GET /admin/backups` checksums every backup file. `GET /ai/availability` and `POST /admin/ai` call the provider: the key check and up to 20 catalog pages, each with a 10 s timeout. While one of them runs, every other write in the app waits, and after the queue window it is answered with 429.

## Decision

- **`defineHandler` takes `transaction: false`** for a handler that only reads. It runs on the pool with no transaction, so it takes no place in the write queue. A handler marked this way must not write.
- **Marked handlers:** `backups` (the backup list), `availability` (AI availability) and `aiTest` (the admin connection test).
- **AI checks used inside write transactions refresh in the background once stale.** `availableCapabilities` awaits only a connection that was never checked, and `loadModels` awaits only a catalog it does not have for the current credential. A stale one is served while a single refresh runs in the background.

## Consequences

- A write added to a marked handler would bypass the queue and could fail with `SQLITE_BUSY`. Review has to catch it; nothing in code enforces it.
- After the connection or the catalog goes stale, the first request after that answers from the last known state. A recovered provider shows up on the next request, not that one.
- Other handlers are unchanged: one transaction per request still holds.
