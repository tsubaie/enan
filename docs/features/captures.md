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
- CAPTURES-B12 Uploads are capped at 25 MB and checked by their magic bytes, not their name or declared type; a recording is at most 15 minutes (900 seconds). The server reads the length from the container header (WebM Segment Info Duration or last Cluster, MP4 `mvhd`, Ogg last granule, WAV data over byte rate, MP3 Xing frame count or constant bitrate), with no decoder and no subprocess. A file its header proves longer than 900 seconds is refused with `422 rule_violation {reason: 'too_long', maxSeconds: 900}`, whatever the client declared. The capture stores, and transcription reserves for, the longer of the declared and the measured length; a file whose header gives no length is estimated at 16 kbps of its size, at most 900 seconds.

## API

All routes take the session guard plus the module's own visibility check (CAPTURES-B02). The recording routes (create, list, count, detail, audio, transcript, transcribe, interpret, delete) are live; the draft review routes (`/captures/suggestions/...`, merge) arrive with the inbox.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/captures` | multipart `file`, `durationSeconds` 0..900, optional `transcript`, `committeeId`, `type`; 201 with the capture. AI off, unconfigured or over budget does not fail it (`needs_transcript`); 422 `too_large` / `unsupported_type`; 429 `{ scope: 'queue' }` |
| `GET` | `/captures` | `cursor`, `limit` (≤ 50); the reader's visible captures newest first, each with its drafts and `audioUrl` |
| `GET` | `/captures/count` | `{ data: { pending } }` for the review badge |
| `GET` | `/captures/:id` | one capture |
| `GET` | `/captures/:id/audio` | the audio, 200 or 206 by `Range` (416 outside it), `Cache-Control: private, no-store`; 404 for anyone who may not see the capture |
| `POST` | `/captures/:id/transcript`, `/transcribe`, `/interpret` | a typed transcript (then interpretation), a transcription retry, an interpretation retry; 409 while a job runs, 422 `no_transcript`, 503 when AI cannot take a retry |
| `DELETE` | `/captures/:id` | 204; soft-deletes the capture and its drafts under one operation id; the binary is kept (ADR 0034) |
| `PATCH` | `/captures/suggestions/:id` | edit a draft with its `revision` |
| `POST` | `/captures/suggestions/:id/approve`, `/discard`, `/undo`; `/captures/suggestions/approve-ready`; `/captures/:id/merge` | review actions |

## UI

- Entry: a 56 px microphone button at the bottom inline-end corner on a phone (S1), and «تسجيل ملاحظة» / "Record a note" with an Alt+V keycap in the desktop header (S9; tooltip «على macOS: ⌥V» / "⌥V on macOS"). Alt/Option+V is registered once in the shell, is a modifier chord only, and is ignored while focus is in a field. Started on a committee page (`/committees?id=…`) the capture carries that committee, shown as a clearable chip.
- First start only: S2 asks before the browser does and says that the audio is sent to be transcribed when transcription is on (remembered on the device). A refused microphone (S3) offers an upload of M4A, MP3, WAV, WebM or OGG instead.
- The recorder is full screen on a phone and a floating card on a desktop. Tap to start; Pause/Resume; Stop. Cancel within 5 seconds discards at once, after 5 seconds it asks (S6). On a desktop Escape pauses and offers Stop and save, Keep recording (the default, focused) and Discard recording (S10). From one minute a non-blocking warning shows (S7); at 15:00 the recording stops and is saved with a toast (S8). The clock, the meter and the microphone do not mirror in RTL.
- After Stop (S11): Recording saved, with the upload, transcription and drafts steps; Done dismisses and Review opens `/captures`. Drafts ready in the same session offer Review now and Later; AI unavailable says the recording was saved (S29); a failed upload holds the recording in the tab only, with Retry (S12).
- The header's «مراجعة» / "Review" carries the count of the reader's own pending drafts and failed captures (S13). `/captures` lists the reader's recordings with their processing state, failure reason and drafts, with Retry and Delete recording; reviewing drafts arrives with the inbox.
- Admin → AI says that recorded audio leaves the server while transcription is on.

## AI (if any)

Job kinds `ai.captures.transcribe` (the existing `notes.transcribe` capability, budget and `ai.model.transcription` slot, admitted on the capture's own kind; dedup `captures.transcribe:<captureId>`) and `ai.captures.interpret` (capability `captures.interpret`, the same text slot as `notes.refine`; dedup `captures.interpret:<captureId>:<transcriptHash>`). The interpreter receives the transcript and a small catalogue as framed data: active committees (id, name), assignable people (id, name), enabled note types and today. The transcript is untrusted data, never instructions; the output is Zod-validated, ids outside the catalogue are dropped (an unmatched spoken owner is kept as words with field state `unknown`), a source sentence not found in the transcript gives no span, an unsure meeting type stays unset and `unknown`, and nothing it returns is executed. Interpretation replaces the pending drafts and sets the capture `ready`; no valid draft fails it with `interpret_failed`. A capture reads as `failed`, with the job's reason, once the job it waits on has failed or been cancelled. Neither job writes a note or a task, notifies (not even `job.finished`), or starts refinement.

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
- Recording: `captures/tests/service.test.ts` (CAPTURES-B01, B05), `api.test.ts` (CAPTURES-B01, B02 across every route, list, count and audio, B12), `repo.test.ts` (CAPTURES-B02 list, paging, count and deleted rows; B09 replacement), `core/files/tests/audio-duration.test.ts` (CAPTURES-B12 header lengths per format, the cap and the size estimate), `jobs.test.ts` (CAPTURES-B01, B02 publish fences, B03, B05, B09), `ui/recorder.test.tsx` (CAPTURES-B01 recorder timing, keys, RTL, pre-permission), `ui/processing.test.tsx` (CAPTURES-B01 focus after Stop), `core/jobs/tests/runner.test.ts` (CAPTURES-B03 no `job.finished`).
- Inbox and end-to-end scenarios for CAPTURES-B04, B06–B08, B10, B11 and CAPTURES-A01–A06 arrive with the inbox.
- Mutation-test targets: `canViewCapture`, `visibleCaptures`, the Approve transaction.

## Audit items

- Every capture path calls `assertCaptureAccess` or filters by `visibleCaptures`.
- No capture code path enqueues `ai.notes.transcribe`, writes into a note before Approve, or emits a notification.

## Out of scope

Meetings records and committee rosters; attaching audio to existing notes; segment-level audio seek; a dedicated upload rate limiter beyond the size, duration and queue limits.
