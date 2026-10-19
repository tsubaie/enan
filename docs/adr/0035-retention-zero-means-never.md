# ADR 0035 — A retention setting of 0 means never

**Status:** accepted (2026-10-18). Extends ADR 0034; supersedes nothing.

## Context

The three data-retention settings on the workspace settings page (`retention.trash_days`, `retention.meeting_files_days`, `retention.backup_count`) required at least 1, so there was no way to say "keep everything". The owner reviewed the page and decided: "If I enter zero, it should not do anything: zero means no deletion or archiving, nothing is deleted, and make sure the user knows that zero means that." The owner also asked that the backup count be labelled clearly as being about backups.

At the time of this decision only backup pruning acts on its setting (after each `system.backup` run). The trash purge and the meeting-file archive job (`system.files.archive`) are specified but not built.

## Decision

- Each retention setting accepts 0, and 0 means never: the trash is kept forever, meeting files are never archived, and no backup is pruned. The upper bounds are unchanged.
- Every job that acts on one of these settings checks for 0 and then does nothing; this is part of each job's spec (ADMIN-B12, MEET-B19, TASKS-B11, NOTES-B11, `03-data-model.md`) so the jobs still to be built inherit it.
- Backup pruning counts and deletes only folders that verify as backups, newest first by manifest time; anything else in the backup directory is left alone.
- The settings page says it: each row has a help line stating what 0 means for that setting, and a field holding 0 shows the state in words instead of its unit (ADMIN-B48).
- The keys and defaults are unchanged (30 days, 365 days, 14 backups), so no stored value changes meaning.

## Consequences

An owner who never wants anything removed can say so on the page. With 0 on the trash or the backups, disk use only grows; the storage quota and manual cleanup remain the controls. A stored 0 written before this decision cannot exist, because the earlier schema refused it.

## Alternatives considered

- A separate "never" switch beside each number: rejected; it doubles the controls for one meaning the owner asked 0 to carry.
- An empty value (null) for never: rejected; an empty field already means "put back what was there", and null would change each setting's type.
