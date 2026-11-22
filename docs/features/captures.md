# Feature: Captures

**Status:** accepted
**Spec reviewed:** 2026-11-22
**Implementation verified:** not yet
**Owner module:** `src/modules/captures`

## Purpose

Let a member speak a note anywhere in the app and review what it becomes before anything goes live. A recording is saved as a capture, transcribed onto the capture, and interpreted into one or more drafts (a task, a meeting note or a committee note). Each draft is approved, edited, discarded or undone by the person who recorded it. Nothing is created and nobody is notified until Approve (ADR 0071).

## Concepts and vocabulary

Capture (one recording with its transcript and processing state), Draft or suggestion (one proposed task or note from a capture), Field state (`confident`, `several`, `unknown`: how sure the interpreter is of one field, shown in words, never as a percentage), Source span (character offsets of the sentence a draft came from, inside the capture's transcript), Type flag (a non-blocking "looks like a …" hint when the kind is uncertain), Live record (the task or note Approve created), Review (the inbox of drafts, labelled «مراجعة» / "Review").

A meeting note is an ordinary note with a type, a date and an optional committee; a committee note is an ordinary note with a required committee. There is no meetings module and no committee roster in v1.

## Data model

See `03-data-model.md` § captures, capture_suggestions. Invariants:

- CAPTURES-I01 `captures` and `capture_suggestions` are additive tables (migration `0021_captures`, ADR 0050). `duration_seconds` is 0..900; `captures.status` is one of `queued`, `transcribing`, `interpreting`, `ready`, `needs_transcript`, `failed`; a suggestion's `kind` is `task`, `meeting_note` or `committee_note`, its `status` `pending`, `approved`, `discarded` or `merged`, and its `live_entity_type` `task` or `note` (CHECKs listing every Zod option). The audio is a `files` row the capture holds with `ON DELETE RESTRICT`; suggestions are owned children (`ON DELETE CASCADE`). The migration copies no `note_voice_memos` row into `captures` and rewrites no note: existing memos stay on the notes they belong to.

Payload shapes, per kind (Zod, stored as JSON in `payload`):

| Kind | Required for Approve | Optional |
|---|---|---|
| `task` | `title` | `ownerId` (an assignable person), `spokenOwner`, `dueDate`, `committeeId`, `description`, `priority`; `status` is always `inbox` |
| `meeting_note` | `title`, `type`, `noteDate`, `body` | `committeeId`, `participantIds`, `tags` |
| `committee_note` | `title`, `committeeId`, `noteDate`, `body` | `type`, `participantIds`, `tags` |

A required field may be held as null while it is unresolved; a field whose state is `unknown`, or `several` without a choice, blocks Approve. An unmatched optional owner does not: the reviewer chooses one or clears it.

## Behaviors

- CAPTURES-B01 A recording stores its audio first (ADR 0054), then inserts a capture row. It creates no note and no task until Approve. AI off, unconfigured or over budget leaves the capture `needs_transcript` with its audio kept.
- CAPTURES-B02 A capture, its suggestions and its audio are visible only to the member who recorded it (`created_by`) and to administrators, on every read, list, count and mutation. Another member, a missing id and a deleted capture all answer `not_found` with `{ entityType: 'capture' }`, never `forbidden`. Lists and counts filter through the same visibility predicate as single reads. The review count is the reader's own pending drafts plus own failed captures, administrators included; administrators reach other members' drafts through an inbox filter.
- CAPTURES-B03 No notification exists before Approve. Recording, transcription, interpretation, editing and discarding emit none. Approve fires only the ordinary side effects of the record it creates (`task.assigned`, `note.mentioned`).
- CAPTURES-B04 Approve never starts refinement and never passes `autoApply`; refining the resulting note stays a manual action.
- CAPTURES-B05 Audio is never attached to an existing note: no automatic write, no manual attach, no in-note recorder. Captures never enqueue `ai.notes.transcribe`.
- CAPTURES-B06 Existing voice memos stay playable (ranged), downloadable and deletable on their notes; a memo that never got text may still be retried with AI or given a typed transcript.
- CAPTURES-B07 `POST /api/v1/notes/voice` and `POST /api/v1/notes/:id/voice` answer 410 `gone` for new audio, in the same release as the review inbox.
- CAPTURES-B08 Listen plays the whole recording and highlights the draft's source sentence in the transcript (the provider returns no segment timestamps).
- CAPTURES-B09 Field states are `confident`, `several` or `unknown`, shown as text and icon, never as a percentage or by colour alone.
- CAPTURES-B10 Approve creates the live task or note from the edited payload in one transaction, then records the live pointer and the live record's revision on the draft.
- CAPTURES-B11 Undo of an approval soft-deletes the live record and returns the draft to pending only while the live record is unedited and within 60 seconds of Approve; otherwise it answers `rule_violation` and the record stays.
- CAPTURES-B12 Uploads are capped at 25 MB and checked by their magic bytes, not their name or declared type; a recording is at most 15 minutes (900 seconds).

## API

Routes arrive with recording and the inbox; this section lists them for the stack. All take the session guard plus the module's own visibility check (CAPTURES-B02).

| Method | Path | Notes |
|---|---|---|
| `POST` | `/captures` | multipart `file`, `durationSeconds`, optional `transcript`, `committeeId`, `type` |
| `GET` | `/captures` | inbox, grouped by capture, newest first |
| `GET` | `/captures/count` | `{ data: { pending } }` for the review badge |
| `GET` | `/captures/:id` | one capture |
| `GET` | `/captures/:id/audio` | ranged audio |
| `POST` | `/captures/:id/transcript`, `/transcribe`, `/interpret` | typed transcript and retries |
| `DELETE` | `/captures/:id` | soft-deletes the capture and its drafts; the binary is kept (ADR 0034) |
| `PATCH` | `/captures/suggestions/:id` | edit a draft with its `revision` |
| `POST` | `/captures/suggestions/:id/approve`, `/discard`, `/undo`; `/captures/suggestions/approve-ready`; `/captures/:id/merge` | review actions |

## UI

Global recorder entry (mobile button, desktop header control, Alt/Option+V), processing states and the review inbox; specified with the recording and inbox work.

## AI (if any)

Job kinds `ai.captures.transcribe` (the existing `notes.transcribe` capability and `ai.model.transcription` slot) and `ai.captures.interpret` (capability `captures.interpret`, the same text slot as `notes.refine`). The transcript is untrusted data, never instructions; the interpreter's output is Zod-validated, invalid names and spans are dropped, and nothing it returns is executed.

## i18n notes

All copy in `en` and `ar` under a `captures` namespace. Waveform, timer and microphone icons do not mirror in RTL; chevrons do.

## Acceptance criteria

- CAPTURES-A01 A signed-in member records from Home (and from Notes, Tasks or Committees), leaves, opens Review and sees a draft from that recording (en, ar).
- CAPTURES-A02 One recording with two drafts: approving one and discarding the other makes exactly one live record (en).
- CAPTURES-A03 An ordinary member opening another member's draft or audio URL gets 404 (en).
- CAPTURES-A04 An administrator can open that draft (en).
- CAPTURES-A05 An existing note with a voice memo still plays it, and the note has no record or upload control (en).
- CAPTURES-A06 Review and the recorder match the approved copy in RTL and LTR (en, ar).

## Required scenarios

- Unit: `captures/tests/schema.test.ts` (CAPTURES-I01, CAPTURES-B09 contracts and catalog; the migration on a database with voice memos), `constraints.test.ts` (CAPTURES-I01 duration and enum CHECKs, audio restrict, draft cascade), `access.test.ts` (CAPTURES-B02 row check, list predicate, count, `not_found`).
- Service, API, jobs, inbox and end-to-end scenarios for CAPTURES-B01, B03–B08, B10–B12 and CAPTURES-A01–A06 arrive with recording and the inbox.
- Mutation-test targets: `canViewCapture`, `visibleCaptures`, the Approve transaction.

## Audit items

- Every capture path calls `assertCaptureAccess` or filters by `visibleCaptures`.
- No capture code path enqueues `ai.notes.transcribe`, writes into a note before Approve, or emits a notification.

## Out of scope

Meetings records and committee rosters; attaching audio to existing notes; segment-level audio seek; a dedicated upload rate limiter beyond the size, duration and queue limits.
