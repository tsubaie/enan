# Feature: People

**Status:** accepted
**Spec reviewed:** 2026-09-07
**Implementation verified:** not yet
**Owner module:** `src/modules/people`

## Purpose

People are the single identity for humans in the workspace: task owners, meeting attendees, requesters, subjects of notes, and the principal. A person may also be a member (`user_id`). Not a CRM.

## Data model

See `03-data-model.md` § people. Invariants:

- PEOPLE-I01 `full_name` required. Duplicate names are allowed; create returns `meta.possibleDuplicates` when a case-insensitive match exists and the UI asks for confirmation. Creating with `confirmDuplicate: true` proceeds.
- PEOPLE-I02 `user_id` unique: one person per member. Linking a person to a user requires admin. A second link to the same user is 409 `conflict` with `reason: "state"`.
- PEOPLE-I03 `is_assignable` controls whether the person appears in owner pickers; tasks already owned keep their owner when it is switched off.
- PEOPLE-I04 The principal (`workspace.principal_person_id`) cannot be deleted or merged as a source. Saving it requires a person who exists and is not in the trash (otherwise 422 `rule_violation`, `unknown_person`); if it still names none, Home shows no principal instead of failing.
- PEOPLE-I05 Deleting a person soft-deletes their contextual links and attendee rows with the same op id; tasks keep `owner_id` (the owner chip renders "deleted person" until restore or reassignment).

## Behaviors

- PEOPLE-B01 **Create**: full name; kind default `external`; `is_assignable` toggle; optional link to a member (admin only).
- PEOPLE-B02 **List**: each list row carries `stats { openTasks, lateTasks, notes }`, counted over live tasks the person owns (late: open with a due date before the workspace's today) and live notes they take part in. Rows with avatar (initials; Arabic names use the first letter of the first two words), name, organization and role, kind chip, open task count (owner edges to non-completed tasks), next meeting date (attendee edges, `starts_at ≥ now`). Views `all` (default), `assignable`, `internal`, `external`, `trash`. Facets: tag, organization, has-open-tasks. Search: name, display name, organization, role, email (the list's field is labelled `people.searchList`, EP-B41). Sort: name (default), open tasks desc, next meeting asc.
- PEOPLE-B03 **Detail**: header, contact, notes, tabs Context (full `LinkedSection`), Tasks (`tasks?linkedTo=person`), Notes (latest five notes where the person is a participant, link to `notes?personId=`; NOTES-B15), Meetings (attendee edges, upcoming first).
- PEOPLE-B04 **Merge** `POST /people/merge { sourceId, targetId }`, admin only, in one transaction: attendee rows moved (a duplicate `(meeting, person)` is dropped, target's role kept); `tasks.owner_id` rewritten to target; contextual links rewritten (duplicates dropped); `user_id`: if both set and differ → 409 `conflict reason: "state"` (unlink one first); if only source set, moved. Source soft-deleted with the op id; the audit entry records the rewritten ids so the merge can be reversed by an admin within retention (`POST /people/:id/unmerge { opId }`).
- PEOPLE-B05 **Stats** for list and detail come from `entity_edges` in one aggregated query.
- PEOPLE-B07 **Delete**: deletion runs on the press through the shared entity behaviour (EP-B36) with no confirmation, because trash is reversible. The panel closes and a toast reads "Person moved to trash" with Undo, which restores the person through the deletion's operation id. A failed delete leaves the panel open and the person untouched, with the error above it.
- PEOPLE-B09 **Identity chip**: an initials avatar shown without the name beside it is a button whose accessible name is the person's full name; pressing or tapping it reveals that name in a popover, dismissed by `Esc`, by activating it again, or by pointing outside. Initials alone identify nobody — an Arabic given name reduces to a single letter — and a title tooltip never appears on touch. Where the name is already visible beside the avatar (pickers, the directory row, the person header) the avatar stays inert.
- PEOPLE-B10 **Tags** `GET /people/tags` returns distinct tags over people not in the trash with counts, most used first, then by name. The record edits tags with the shared tag field (docs/design-system.md § Chips and tags), the one notes use (NOTES-B13): chips with the × inside, an input whose list offers these tags without the ones already on the person, an "Add" row for a new name, and at most ten tags.
- PEOPLE-B11 **Kind**: internal or external is chosen with the capsule segmented control, both values visible, in the record and in the create form. Choosing the other value saves at once.
- PEOPLE-B12 **Name**: in the record the full name is the heading and is edited in place; Enter or leaving the field saves a changed, non-empty name, and an empty name shows "Enter a name before leaving this field." There is no separate full-name row. The create form keeps its full-name field.
- PEOPLE-B13 **Login by address**: an internal record whose email is, case-insensitively, the address of an active workspace login that no directory record holds yet is linked to that login when it is created, when it is patched to internal or given that address, and when the login is created after the record (the one live, unlinked internal record carrying the address; two such records are an ambiguity a person resolves, so neither is linked). An explicit `userId` from an administrator always wins. The record says, under its kind, whether it reaches a login (ADR 0066).
- PEOPLE-B08 **Totals**: `meta.counts` always ships; `meta.total` is present only when the request asks for it with `withTotal=true` (`04-api-conventions.md` § Lists).
- PEOPLE-B06 Invalidation: person list, detail, links of the person; on merge additionally tasks lists and meetings details touched.

## API

| Verb | Path |
|---|---|
| GET/POST | `/people` (`view, q, tag, organization, hasOpenTasks, sort, limit, cursor`) |
| GET | `/people/tags` |
| GET/PATCH/DELETE/restore | `/people/:id` |
| POST | `/people/merge`, `/people/:id/unmerge` (admin) |

## Acceptance criteria

- PEOPLE-A01 Creating an assignable person makes them selectable as a task owner; assigning them shows the task in their Tasks tab and Context tab. (en, ar)
- PEOPLE-A02 Adding a person as an attendee shows the meeting in their Meetings tab. (en)
- PEOPLE-A03 Merging two people moves attendee rows, task ownership, and links; the source disappears from the directory and the merge is reversible by unmerge within retention. (en)
- PEOPLE-A04 Merging two people that are both linked to different members is refused with a clear message. (en)
- PEOPLE-A05 Creating a person with an existing name asks for confirmation and does not create a duplicate until confirmed. (en, ar)
- PEOPLE-A06 Arabic names render correct initials. (ar)

## Required scenarios

- service: I01–I05, B04 (six cases: plain, duplicate attendee, both users, only source user, principal as source, unmerge), B05.
- repo: stats in one query (query counter), views, search normalization.
- api: all endpoints, admin gating on merge and user linking.
- ui: avatar initials en/ar, duplicate confirmation, tabs, undoable deletion (B07), avatar name reveal by pointer and keyboard (B09).
- Mutation targets: `mergePeople`, `initials`, `possibleDuplicates`.

## Audit items

- No module references `task_owners` (table does not exist).

## UI

List: cards built from the shared card pieces (docs/design-system.md § Cards) show what a person is carrying (PEOPLE-B02). Each card has an initials circle, the name, and the role title as the Light line. Its icon facts are the open tasks the person owns ("No open tasks" when none), the late ones in the danger ink, and the notes they took part in. The first two tags and the kind are chips in the trail. Contact details and the assignment flag stay in the record and the table.

Record (docs/design-system.md § Records): a neutral avatar beside the editable name (22 px Semibold, PEOPLE-B12), with nothing under it, since role and organisation are rows below. Every property is a row of one property sheet: the text fields, kind as a segmented control (PEOPLE-B11), assignment as a checkbox row, and tags as the shared tag field (PEOPLE-B10). An empty value shows a faint "Add…". Notes are the markdown field a task's description uses. Assigned tasks and notes are sections whose items sit on an inset sheet, each closed by a small grey capsule button to the full list. A late assigned task carries a red capsule at its row's end with a clock, the word "Overdue" and how long ago it fell due, with the exact date on hover.
