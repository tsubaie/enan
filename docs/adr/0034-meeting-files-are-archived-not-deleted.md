# ADR 0034 — Meeting files are archived, never deleted

**Status:** accepted (2026-10-18). Supersedes the file purge recorded in `features/meetings.md` (MEET-I08, MEET-B19) and `03-data-model.md` (§ files, the seeded `system.files.purge` schedule); no earlier ADR recorded it.

## Context

The Meetings spec said that once every meeting a file belongs to is older than `retention.meeting_files_days`, a scheduled job `system.files.purge` deletes the binary and marks the row `purged`, keeping briefs and extracted text. A binary no non-deleted document referenced was to be deleted too. The owner reviewed the setting on the administration page and decided: "I do not want anything to be deleted. So yes should be archived after that period."

The Meetings module and the job are not built yet. Only the `files` table exists, and it is empty in every install.

## Decision

- The application never deletes a meeting file's binary: not by retention, and not when no non-deleted document references it any longer. The row and the binary stay.
- When every document referencing a file belongs to a meeting older than `retention.meeting_files_days` (the condition the purge used), the scheduled job `system.files.archive` (daily 03:30, replacing `system.files.purge`) sets the file's `availability` to `archived` and records `archived_at`. The binary is kept on disk and included in backups exactly as before.
- An archived file still opens from its meeting and is labelled "Archived". In the meeting's documents it moves from the main list to an archived group.
- A new upload that reuses an archived file's row (same sha256) on a meeting within the retention period makes it `available` again and clears `archived_at`, because the file no longer meets the archive condition.
- Briefs and extracted text are unchanged by archiving.
- The availability states are `available`, `archived` and `missing`. `missing` keeps its meaning: the binary was not found at read time, which is logged as an error. Migration `0001` maps any `purged` row to `missing`, since such a binary is gone; no install has one.
- The setting keeps its key `retention.meeting_files_days`, to avoid churn; its label becomes "Archive meeting files after".
- The hourly orphan sweep is unchanged: it removes binaries left by an upload whose database transaction never committed (MEET-B12). Such a binary was never attached to a meeting.

## Consequences

Nothing the owner uploaded disappears on a schedule. Disk use and backup size grow with every upload and never shrink; at the scale of one office's meeting papers this is small, and the storage quota and backup retention remain the controls. Archiving is a presentation and lifecycle state only, so it is fully reversible. Removing a binary for good, if ever needed, is a separate decision that needs its own ADR.

The soft-delete purge of trash rows (`retention.trash_days`) for tasks, notes and other entities is a separate question and is not changed by this decision.

## Alternatives considered

- Keep the purge as specified: rejected by the owner, who wants no automatic deletion.
- Remove the setting and keep every file in the main list forever: rejected; old meetings' papers would crowd the documents list, and the owner chose archiving after the period.
- Compress or move archived binaries to separate storage: rejected for now; it adds a second storage path and a restore concern for a small saving.
