# ADR 0067 — Reads run outside the write lock

**Status:** accepted (2026-10-28). Extends ADR 0045: its opt-in stays for slow handlers of other methods; reads no longer opt in, and the write ban it left to review is enforced in code.

## Context

ADR 0029 put every request in one immediate transaction behind the process-wide write queue, and ADR 0045 let three slow reads opt out of it. The other 119 of 129 handlers still took the lock, among them every list, detail and feed `GET`. So every page load waited behind every write, the notification poll of every open tab queued with them, and a read that waited past the window was answered 429. The job runner's idle tick opened one immediate transaction per registered kind every second, each with a sweep and a candidate query, with nothing to claim.

## Decision

- **A `GET` runs on the pool without a transaction** unless its handler sets `transaction: true`. No GET writes today; one that must keeps the request's transaction that way.
- **A request without a transaction gets a read-only handle.** Its `ctx.db` refuses `insert`, `update`, `delete` and `replace` statements on the pool, so a write added to such a handler fails its request loudly instead of running unqueued. A service's own `withTransaction` on that handle still opens a queued immediate transaction (ADR 0054), which is how the wallpaper and voice uploads write.
- **`transaction: false` keeps its meaning** for a slow handler of another method, and gets the same read-only handle.
- **The runner claims only kinds with work.** Each tick first reads, outside the lock, which kinds have a queued or running job and calls `claim` for those alone. A running job with an expired lease is among them, so nothing is lost; an idle tick opens no transaction.

## Consequences

- Two statements of one GET may run on different pooled connections and see different commits (WAL). A list shown beside its count tolerates that; no read-only handler needs one snapshot across statements. `BEGIN DEFERRED` is the upgrade if one ever does.
- A write on the pool outside a transaction is a 500 logged as an error, caught by the first test that runs the handler.
- The sweep that cancels and deadlines queued or running jobs runs on every claim of a kind that has such jobs, before the admission check, so a kind at its concurrency limit still sweeps; it has nothing to do when none exist.

## Alternatives considered

- **Marking each read-only handler `transaction: false`.** Some forty flags that the next handler forgets, and nothing refusing a write. Rejected.
- **`BEGIN DEFERRED` for reads.** One snapshot across statements, at the cost of a pooled connection held for the request and a second transaction kind to reason about, for a consistency nothing needs. Rejected.
