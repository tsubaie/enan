# ADR 0026 — A restore that may have split database and files stays in maintenance; restores are serialized; drained jobs retry

**Status:** accepted (2026-09-27)

## Context

ADR 0024 staged restores and added the runner drain. Its review found three gaps (#60).

- ADR 0024 says a `finally` always clears maintenance mode, and that a failed restore leaves the installation serving the data it had before. That holds only while `pg_restore` has not committed. If the file swap fails after the commit, the swap rolls the live files back, but the database already holds the backup's data. Clearing maintenance then serves a database and files from different points in time.
- Nothing stopped two restores from running at once. Each clears stale `.restore-*` directories on start, so one could delete the other's staging, and either could clear the shared maintenance marker while the other was still running.
- The drain aborts running handlers after `JOBS_DRAIN_SECONDS`. The runner then classified the abort like any other error. An `ai.*` job has no transient `reason` on that path, so it was recorded as a `provider` failure without a retry, and an interrupted AI job failed permanently on every deploy that outlasted the drain.

## Decision

**Maintenance stays on while database and files may disagree.** Maintenance mode is cleared on every exit except two. The first is a file swap that fails after `pg_restore` commits. The second is any failure of a restore that started with the marker already present. Restores are serialized (below), so a marker found at start was left by a restore that did not finish: a failed post-commit swap, or a process killed partway. In both cases the command fails with an instruction to run the same restore again. `pg_restore --clean` and a fresh extraction make the rerun a complete recovery, and only a successful restore clears the marker. Staging is still removed on every exit, because the rerun extracts again from the operator's backup directory.

**One restore at a time.** The restore, from clearing stale staging to clearing maintenance, runs under PostgreSQL session advisory lock `defaults.restoreLock` (7235). It is taken with `pg_try_advisory_lock` on a dedicated pooled connection (`core/db/locks.ts`). A second restore fails at once with "Another restore is already running", before it touches staging or the marker.

**Shutdown is not a failure.** The drain aborts handlers with one shared shutdown reason. The runner checks the signal's reason for it before classifying the error, and records the attempt as `fail(job, 'shutdown', retry = true)` whatever the job kind. A user cancellation or a lost lease aborts without that reason and keeps its own outcome. `fail` still ends a job whose cancellation was requested as `cancelled`.

This supersedes, for these three points only, ADR 0024's "a `finally` always … clears maintenance mode", its consequence "a failed restore leaves the installation serving the data it had before", and its drain wording. Everything else in 0024 stands.

## Consequences

- A restore that fails after the commit, or a failed rerun, leaves the app answering 503 until a restore succeeds. This is deliberate: a visible outage is safer than serving mismatched data.
- A failed rerun of a restore that was killed before its commit also stays in maintenance, although that database did not change. Telling the two cases apart would need a durable record of the phase. Rerunning is cheap, so the conservative answer is kept.
- The restore command opens a database connection for the lock and ends its pool when it finishes.
- A shutdown-interrupted attempt still counts toward `max_attempts` (ADR 0010). A job interrupted on its last attempt therefore ends failed.

## Alternatives considered

- **Roll files forward instead of back after a post-commit failure.** The swap failed, often for the same reason on a retry, such as a full or read-only volume. Retrying it in place also cannot cover a process that was killed. The marker covers both.
- **Keep staging after a post-commit failure for manual completion.** Rejected: it keeps a second full copy of the files on the volume, and a rerun is the documented, complete recovery.
- **A lock file in `BACKUP_DIR`.** Rejected: it survives a crashed process and would block every later restore until removed by hand. PostgreSQL releases an advisory lock when its session ends.
- **Classify shutdown by the thrown error's shape.** Rejected: providers and the SDK wrap aborts differently. The runner's own signal reason is the one reliable marker.
