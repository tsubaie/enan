# ADR 0050 — The phone layout

**Status:** accepted (2026-10-22). Extends ADR 0031 below 1024 px; the desktop it describes is unchanged.

## Context

On a 390 px phone a list spent 230 to 330 px above its first record: a title row with a wide Create, a search row, a sort and filter row, a period row on KPIs and a featured strip that ran off the edge. Cards differed in height by what each happened to carry, a record replaced the list as a full screen left by a Back button, and the menu's mark appeared nowhere. The owner reviewed each screen on a phone and chose the arrangement below.

## Decision

- **The header carries the page.** The Enan mark leads the phone's header in its accent tile and leads home; the list title and its view summary sit beside it, as from 1024 px (EP-B07). The view summary may shorten with an ellipsis so it never runs under the header's utilities.
- **One toolbar row.** Search takes the width, then Filter and a round Create at the end edge, drawn at 36 px with a 44 px touch target (Apple's minimum). The sort moves into the filter sheet, which leads with the views; selecting is a desktop task; the featured strip gives way to the header's view menu (EP-B32, EP-B40).
- **Cards are one shape.** Every card list (tasks, notes, committees, people) draws 72 px cards: the name on one line, the facts that decide what to do (a task's due date and priority, a note's date and type, someone's open and late tasks) and the trail beside them. Whatever a module marks `data-card-more` is left to the record, and card lists load as card placeholders.
- **A record is a sheet.** A record or create form rises from the bottom over the list, in the desktop panel's glass over the same blurred backdrop (EP-B23). It closes with its cross, a tap on the dimmed page, or a pull down from the top of its content, and slides away as it goes; the bottom bar hides while it is open (EP-B38). Its fields read as values until tapped, as on a desktop (EP-B25).
- **The bottom bar reads Home, Tasks, Notes, KPIs, More.** A module may take a different place (`phoneOrder`) and a shorter name (`phoneKey`) there; labels are capped to their slot and are 11 px under 360 px. The language toggle is the last row of More.
- **Sheets share one material.** The filter and More sheets take the record panel's glass and backdrop; with reduced transparency they are solid.
- **Counts are circles.** The side menu shows the open tasks, and KPIs only when some are off target, in red; the views rail's counts use the same circle.

## Consequences

- Two requirements changed meaning and their scenarios follow: the record's way out is one cross at every width (EP-B38), and a phone shows no featured strip (EP-B40).
- Selecting several records, and choosing between cards and a table, are desktop tasks.
- A phone card no longer shows a task's status, committee or subtasks, a note's task count or a committee's last note; the record does.
