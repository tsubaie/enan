# ADR 0061 — Lists show more on request, and the audit log reads as a diff

**Status:** accepted (2026-10-23).

## Context

Long lists loaded fifty rows and a "Load more" button sat at their end, styled differently in each place; the admin lists showed every row, so on the backups page the restore panel moved further down with every backup. The audit log said what was done but not to which record unless the change carried a title, showed only new values, and left out sign-ins, the first thing an administrator of a self-hosted install looks for.

## Decision

- **Show more, never infinite scroll** (EP-B47). Enan's lists are worked in: rows are selected, opened and returned to, and content often sits below them. One shared control ends every long list, centred, with a count; the next loaded row shows beneath it, faded and inert. Tasks show twenty at a time, backups five, jobs and the audit log twenty-five.
- **The audit log records the state before an edit** (ADMIN-B71). An edit's entry also holds `_before`, what its changed fields read before it, except long text; every edit, deletion and restore names its record under `_name`, and a KPI reading or target its KPI. The page shows the change as a diff, red for what was, green for what is.
- **Sign-ins are audited and filtered apart** (ADMIN-B72). Successful sign-ins name the member and the method; failed password and code attempts name the email tried, only when it is a real email, and are pruned after thirty days with the login attempts they mirror, since anyone can cause one. "All entries" excludes them.
- **The log is narrowed on the server** (ADMIN-B72, ADMIN-B73): by kind, by what was done, and by days in the workspace's time zone, so each narrowing has its own newest hundred.

## Consequences

- Entries written before this ADR have no `_before` or `_name`; they show what they hold.
- An edited short field's previous value is kept in the log as long as the log is, as its new value already was.
- The log grows with sign-ins for thirty days at a time; changes are kept for good, as before.

## Alternatives considered

- **Infinite scroll.** Pushes everything below a list out of reach, loses the reader's place, and is harder with a keyboard or a screen reader.
- **Reading old values from the database at display time.** The old value is gone once the row is updated; only the write knows it.
- **Filtering on the page.** The page holds the newest hundred, which a burst of sign-ins could fill entirely.
