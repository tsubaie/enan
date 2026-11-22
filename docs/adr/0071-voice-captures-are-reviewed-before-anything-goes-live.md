# ADR 0071 — Voice captures are reviewed before anything goes live

**Status:** accepted (2026-11-22). Supersedes ADR 0070 for new recordings: a new recording no longer writes itself into a note or applies its own refinement. ADR 0070's transcription path (capability `notes.transcribe`, slot `ai.model.transcription`, cost by the second) and ADR 0065's audio-first storage stand and are reused.

## Context

ADR 0070 made a voice memo finish itself: the transcript was appended to the note and a refinement applied with `autoApply`. A recording usually holds more than one thing (an action for someone, what a committee agreed, a personal reminder), and writing it into one note put work for other people where nobody would find it, under a note nobody reviewed. Attaching audio to an existing note also meant a recording could change a record its author was not looking at. Everything else AI produces in Enan is a proposal reviewed before it applies (`06-ai-integration.md`); voice was the one exception.

## Decision

- **A recording is a capture, not a note.** It is stored as a `captures` row holding the audio (a `files` row written first, ADR 0054), its duration, its transcript and its processing state. Captures are their own module (`src/modules/captures`) with their own tables, `captures` (entity) and `capture_suggestions` (child), added by an additive migration (ADR 0050).
- **A capture becomes drafts, and only Approve makes them live.** A transcribe job writes the transcript onto the capture; an interpret job turns it into one or more suggestions, each a task, a meeting note or a committee note, with per-field states `confident`, `several` or `unknown` (never a percentage). A draft can be approved, edited, discarded, merged with a sibling of the same kind, or undone. Approve creates the task or note through the owning module's ordinary create service, in one transaction.
- **Drafts are private to the recorder and administrators.** Every read, list, count and mutation goes through one visibility rule: `created_by` is the reader, or the reader is an administrator. Anyone else gets `not_found`, the same as a missing id, so an id reveals nothing. The session guard is used, not the admin guard, which would hide a draft from its recorder.
- **Nothing notifies and nothing refines before Approve.** Recording, transcribing, interpreting, editing and discarding emit no notification. The only notifications are the ordinary `task.assigned` and `note.mentioned` side effects of the record Approve creates. Approve never starts refinement and never passes `autoApply`; refining the resulting note stays a manual action, and a manual refine may propose tasks again as it does for any note.
- **Captures reuse transcription, not its publisher.** New job kinds `ai.captures.transcribe` (the existing `notes.transcribe` capability and `ai.model.transcription` slot) and `ai.captures.interpret` (a new capability `captures.interpret` on the same text slot as `notes.refine`). Captures never enqueue `ai.notes.transcribe` and never call its note-writing publish. Each job publishes only onto the capture its payload names, after its job id still matches.
- **The transcript is data, and the interpreter's output is a proposal.** The prompt tells the model to ignore instructions inside the recording; the output is validated by a strict schema, names and ids that do not resolve are dropped, never invented, and nothing in it is executed. A run that yields no valid draft fails the capture with `interpret_failed`.
- **No audio is attached to an existing note.** Record-first note creation (`POST /notes/voice`) and attaching to a note (`POST /notes/:id/voice`) are retired with 410 `gone` in the same release as the review inbox, so the two models never ship side by side. Existing `note_voice_memos` stay on their notes: playable, downloadable, deletable, and a memo without text may still be retried or typed. No memo is copied into `captures` and no historical note content is rewritten.
- **Undo is fenced on the server.** Undoing an approval soft-deletes the live record only while its revision still equals the one recorded at Approve and within 60 seconds of it; a batch undo is all or nothing.
- **A workspace setting is the rollback hatch.** `captures.inbox` (default on) may restore record-first note creation only, never `autoApply` and never attach; the new tables stay.

## Consequences

A recording no longer turns into a finished note by itself: the recorder spends a moment in Review, and in return one recording can produce several correctly placed records, each checked before anyone else sees it. Nothing a recording produces can notify someone or reach a shared list until a person approves it. Audio still leaves the server for transcription when AI is on, as under ADR 0070. Existing memos and the notes they produced are unchanged. The capture tables stay unused if the inbox is rolled back.

## Alternatives considered

- Keep ADR 0070's auto-write and add review afterwards: rejected; a written note is already visible and may already have notified.
- Store drafts as notes with a draft flag: rejected; every notes list, search, count and committee tab would have to learn to hide them, and one missed filter leaks a draft.
- Mirror existing voice memos into captures: rejected; those recordings were already reviewed by being written into their notes, and rewriting history would change records people rely on.
- Use the admin guard for draft routes: rejected; it hides a draft from the person who recorded it.
