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
- CAPTURES-B07 `POST /api/v1/notes/voice` and `POST /api/v1/notes/:id/voice` answer 410 `gone` `{ reason: "retired", use: "/api/v1/captures" }` for new audio, in the same release as the review inbox, and create no note and no memo. Both answer before the body is read: `POST /notes/voice` checks `captures.inbox` first, so a missing, invalid or valid upload alike gets 410 and nothing is buffered. The workspace setting `captures.inbox` (boolean, default `true`; an administrator writes it through `PATCH /admin/settings`) is the post-release rollback: off, `POST /notes/voice` creates a note from a recording again (NOTES-B36), with no refinement and no attach; `POST /notes/:id/voice` stays 410 and the notes-list strip does not come back. The capture tables stay either way.
- CAPTURES-B08 Listen plays the whole recording and highlights the draft's source sentence in the transcript (the provider returns no segment timestamps).
- CAPTURES-B09 Field states are `confident`, `several` or `unknown`, shown as text and icon, never as a percentage or by colour alone.
- CAPTURES-B10 Approve creates the live task or note from the edited payload in one transaction, through the owning module's own create (`createTask`, `createNote`), then records the live pointer, the live record's revision, `approved_at` and `approved_by` on the draft. It requires the draft's `revision` and every required field settled (422 `rule_violation` `{ reason: "unresolved", fields }` otherwise); a type flag never blocks. A second Approve with the same revision answers with the first live record and creates nothing. Approve N ready approves, in one transaction, exactly the listed drafts (422 `{ reason: "not_ready", id }` if one is not ready, and nothing is approved) or, without ids, the reader's own ready drafts, skipping the rest. An edit (`PATCH`) is checked against its kind's contract and settles the fields it sets; a changed kind keeps the shared fields (a task's description is a note's body). Discard needs no confirmation. Merge joins drafts of one recording and one kind: the kept draft takes the others' source sentences and the others become `merged`; across kinds it is 422 `{ reason: "kind" }`. A task draft's `source_note_id` stays empty: sibling drafts are not linked. In the inbox a field saves when it is left; Approve or Discard pressed while that save is being sent waits for it, busy and with «Saving your change…» in words, then is sent once with the revision the save answered; if the save fails nothing is sent and the failure is shown. An edit made while another is being saved is not dropped: edits made meanwhile are merged (the latest value of each field and the latest kind win) into one `PATCH` sent after the one in flight, with the revision it answered, and Approve or Discard waits for that one too; if the first fails the merged edit is not sent. Approve N ready waits for every save being sent, reads the list again and approves the drafts ready in it, leaving out any whose latest save failed. Its toast adds, at high priority, how many drafts ready at the click were left out because their last change did not save («استُبعدت مسودة واحدة لأن آخر تعديل عليها لم يُحفظ، وما زالت في المراجعة.») and how many were no longer ready («ما زالت مسودة واحدة تحتاج إلى اختيار، فبقيت في المراجعة.»), and focus goes to the first draft left out; with nothing left to approve it sends nothing and says «لم تُعتمد أي مسودة. راجع المسودات المشار إليها ثم أعد المحاولة.» / "No drafts were approved. Check the drafts marked in Review, then try again." at high priority.
- CAPTURES-B11 Undo of an approval soft-deletes the live record (its module's delete, with a new `deleted_op_id`) and returns the draft to pending only while the live record's revision still equals the one recorded at Approve and within 60 seconds of Approve; otherwise it answers 422 `rule_violation` `{ reason: "undo_unavailable" }` and the record stays. Undo of a discard returns the draft to pending. Undoing an Approve N ready batch (`POST /captures/suggestions/undo` with its ids) is one transaction, all or nothing. Notifications the approval already sent stay sent.
- CAPTURES-B12 Uploads are capped at 25 MB and checked by their magic bytes, not their name or declared type; a recording is at most 15 minutes (900 seconds). The server reads the length from the container header (WebM Segment Info Duration or last Cluster, MP4 `mvhd`, Ogg last granule, WAV data over byte rate, MP3 Xing frame count or constant bitrate), with no decoder and no subprocess. A file its header proves longer than 900 seconds is refused with `422 rule_violation {reason: 'too_long', maxSeconds: 900}`, whatever the client declared. The capture stores, and transcription reserves for, the longer of the declared and the measured length; a file whose header gives no length is estimated at 16 kbps of its size, at most 900 seconds. Reading a header takes at most 10,000 steps (elements, boxes, chunks or scan candidates); a header that needs more gives no length, so a 25 MB file of tiny parts cannot stall the server. Each refusal names its reason (`too_large`, `unsupported_type`, `too_long`), and the client says it in the person's words as a high-priority toast; a refused file chosen from S3 reopens S3 with the reason inline (`role="alert"`) and focus on Upload audio, and a refused recording stays held with Retry.

## API

All routes take the session guard plus the module's own visibility check (CAPTURES-B02); a draft is reached through its capture, so another member's, a missing and a deleted one answer the same 404.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/captures` | multipart `file`, `durationSeconds` 0..900, optional `transcript`, `committeeId`, `type`; 201 with the capture. AI off, unconfigured or over budget does not fail it (`needs_transcript`); 422 `too_large` / `unsupported_type`; 429 `{ scope: 'queue' }` |
| `GET` | `/captures` | `scope` (`mine`, the default, or `all`: everyone's for an administrator, the reader's own for a member), `cursor`, `limit` (≤ 50); captures newest first, each with its drafts and `audioUrl` |
| `GET` | `/captures/count` | `{ data: { pending } }` for the review badge |
| `GET` | `/captures/:id` | one capture |
| `GET` | `/captures/:id/audio` | the audio, 200 or 206 by `Range` (416 outside it), `Cache-Control: private, no-store`; 404 for anyone who may not see the capture |
| `POST` | `/captures/:id/transcript`, `/transcribe`, `/interpret` | a typed transcript (then interpretation), a transcription retry, an interpretation retry; 409 while a job runs, 422 `no_transcript`, 503 when AI cannot take a retry |
| `DELETE` | `/captures/:id` | 204; soft-deletes the capture and its drafts under one operation id; the binary is kept (ADR 0034) |
| `PATCH` | `/captures/suggestions/:id` | `{ revision, kind?, payload }`; the draft; 400 a field its kind refuses, 409 stale revision or not pending |
| `POST` | `/captures/suggestions/:id/approve` | `{ revision }`; `{ suggestion, live: { type, id } }`; 409 stale or not pending, 422 unresolved |
| `POST` | `/captures/suggestions/approve-ready` | `{ ids? }`; `{ approved: [{ suggestion, live }] }`; 422 `not_ready` |
| `POST` | `/captures/suggestions/:id/discard` | `{ revision }`; the draft, `discarded` |
| `POST` | `/captures/suggestions/:id/undo`, `/captures/suggestions/undo` | one draft, or `{ ids }` for a batch; 422 `undo_unavailable` |
| `POST` | `/captures/:id/merge` | `{ keepId, mergeIds }`; the kept draft; 422 `kind` |

## UI

- Entry: a 56 px microphone button at the bottom inline-end corner on a phone (S1), and «تسجيل ملاحظة» / "Record a note" with an Alt+V keycap in the desktop header (S9; tooltip «على macOS: ⌥V» / "⌥V on macOS"). Alt/Option+V is registered once in the shell, is a modifier chord only, and is ignored while focus is in a field. Started on a committee page (`/committees?id=…`) the capture carries that committee, shown as a clearable chip.
- First start only: S2 asks before the browser does and says that the audio is sent to be transcribed when transcription is on (remembered on the device). A refused microphone (S3) offers an upload of M4A, MP3, WAV, WebM or OGG instead.
- The recorder is full screen on a phone and a floating card on a desktop. Tap to start; Pause/Resume; Stop. Cancel within 5 seconds discards at once, after 5 seconds it asks (S6). On a desktop Escape pauses and offers Stop and save, Keep recording (the default, focused) and Discard recording (S10). From one minute a non-blocking warning shows (S7); a second before 15:00 (899 seconds, so encoder padding cannot carry a full-length recording past the 900-second cap) the recording stops and is saved with a toast (S8). The clock, the meter and the microphone do not mirror in RTL.
- After Stop (S11): Recording saved, with the upload, transcription and drafts steps; Done dismisses and Review opens `/captures`. Drafts ready in the same session offer Review now and Later; AI unavailable says the recording was saved (S29); a failed upload holds the recording in the tab only, with Retry (S12).
- The header's «مراجعة» / "Review" carries the count of the reader's own pending drafts and failed captures (S13). On a desktop it opens Review as a side panel beside the page, with Open as a page and Close; on a phone, and as a link, it is the `/captures` page (read on the server for the reader, then kept fresh on the client). Administrators have Show everyone's drafts (`?scope=all`).
- Review (S14) says how many drafts wait and offers «اعتماد ٣ جاهزة» / "Approve 3 ready" (S23) for every shown draft with nothing required left, type flags included; with none it reads «لا مسودات جاهزة بعد» / "No drafts are ready yet". The first visit shows S30's line, «المسودات يراها من سجّلها والمسؤولون فقط، ولا تُعتمد إلا بطلبك.» / "Only you and admins can see drafts. Nothing goes live until you approve.", until it is dismissed on that device. Empty (S16): «لا مسودات بانتظار المراجعة.» with Record a note and its Alt+V keycap.
- A recording group (S15) reads «من تسجيل ١٢:٤٠ | ٣ مسودات» / "From the 12:40 recording | 3 drafts" (a recording with no drafts: «تسجيل ١٨:٠٥» / "18:05 recording"), then its age and its length, the parts split by a 1px rule; play/pause plays the whole clip; Full transcript opens the transcript; Merge (S24) appears with two or more drafts and is disabled unless two share a kind. A group still working says Transcribing… or Preparing drafts…; a failed one says why (no speech, timed out, or could not prepare drafts) with Retry, Type the transcript and Delete recording (S17); one AI could not take says so with Type the transcript and Retry (S29).
- A draft (S18) is a card with its kind as a changeable chip («يبدو كمحضر اجتماع» / "Looks like a meeting note" when the interpreter was unsure), its state in words and an icon (Ready, Choose the committee, Required field, Non-blocking flag), its title and its values; Approve, Edit and Discard. On a desktop it is edited inline (`layout: panel`, opened at once when something is unsettled); on a phone the list shows compact cards (`compact`) and Edit opens the draft full screen (`screen`). Fields are saved as they are left. A required field unsettled shows «لم نتعرّف على اللجنة» / "We didn't recognise the committee" or Choose the committee with its candidates and the picker (S20, S21); Approve then stays focusable with `aria-disabled` and says «اختر اللجنة أولاً.» / "Choose the committee first." under it (S22). An unmatched owner says what was heard, offers Choose and Clear owner, and explains it does not block (S21). Source quotes the draft's sentence and Listen plays the whole recording from the start while that sentence is highlighted in the transcript (CAPTURES-B08).
- Approve shows a five-second toast with Undo and View (S26): «أُنشئت المهمة «…».», «أُنشئ المحضر «…».», «أُضيفت الملاحظة إلى «…».», or «اعتُمدت ٣ مسودات.» for a batch, whose Undo undoes the whole batch. Undo done reads «تُراجع الاعتماد. المسودة في صندوق المراجعة.»; refused, «تعذر التراجع لأن السجل عُدّل.» (S27). Discard shows «تجاهلت المسودة.» with Undo (S28). There is no attach-to-note action anywhere in Review.
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
- Recording: `captures/tests/service.test.ts` (CAPTURES-B01, B05), `api.test.ts` (CAPTURES-B01, B02 across every route, list, count and audio, B12), `repo.test.ts` (CAPTURES-B02 list, paging, count and deleted rows; B09 replacement), `core/files/tests/audio-duration.test.ts` (CAPTURES-B12 header lengths per format, the cap, the size estimate and the bounded parse), `jobs.test.ts` (CAPTURES-B01, B02 publish fences, B03, B05, B09), `ui/recorder.test.tsx` (CAPTURES-B01 recorder timing, keys, RTL, pre-permission), `ui/processing.test.tsx` (CAPTURES-B01 focus after Stop), `core/jobs/tests/runner.test.ts` (CAPTURES-B03 no `job.finished`).
- Review: `captures/tests/approve.test.ts` (CAPTURES-B03, B04, B10: edited payload, notifications only at Approve, no refinement, double Approve, Approve N ready, edits per kind; a draft edited to an unassignable owner, a missing, deleted or archived committee or an unknown participant refused with nothing created or notified), `undo.test.ts` (CAPTURES-B11: within the window, edited, expired, batch all or nothing, discard), `merge.test.ts` (CAPTURES-B10 same kind, across kinds), `visibility.test.ts` (CAPTURES-B02 every review route, list and count for member A, member B and an admin; drafts absent from the notes list, search and the committee tab), `ui/inbox.test.tsx` (S30 once, Listen, owner Choose/Clear, disabled reason, no discard confirm, header rule, Arabic; busy and failed Approve, Approve N ready and Merge; focus after Approve, Discard and Merge; the cross-kind Merge reason; Approve, Discard and Approve N ready after an edit wait for its save, and a failed save sends nothing; a second edit during a save is chained with the saved revision; Approve N ready says what it left out and why, focuses it, and sends nothing when nothing is left; the Arabic plural forms).
- Retirement: `notes/tests/voice-api.test.ts` (CAPTURES-B07 both POSTs 410 with nothing stored, 410 before a missing, invalid or valid body is read, the rollback; CAPTURES-B06 audio, delete and transcript on an existing memo), `notes/tests/voice-ai.test.ts` (CAPTURES-B05 a memo's transcription stays on the memo; a transcription queued before the release finishes or fails cleanly through the runner), `notes/tests/ui/voice-memos.test.tsx` (CAPTURES-B05 no record or upload control).
- e2e `captures.spec.ts`: CAPTURES-A01–A04, A06; `notes.spec.ts`: CAPTURES-A05 (with NOTES-A15).
- Mutation-test targets: `canViewCapture`, `visibleCaptures`, the Approve transaction.

## Audit items

- Every capture path calls `assertCaptureAccess` or filters by `visibleCaptures`.
- No capture code path enqueues `ai.notes.transcribe`, writes into a note before Approve, or emits a notification.

## Out of scope

Meetings records and committee rosters; attaching audio to existing notes; segment-level audio seek; a dedicated upload rate limiter beyond the size, duration and queue limits.
