# ADR 0065 — Voice memos save their audio first and take their transcripts from the reader

**Status:** accepted (2026-10-27). Extends ADR 0054 and ADR 0034.

## Context

Issue #113 asks for voice memos on notes: record or upload audio, keep it on the note, and turn what was said into a structured brief and tasks. AI calls go through `src/core/ai` on a messages API (ADR 0016, ADR 0017), which takes text, images and PDFs but not audio, and the product admits no separately running services or subprocesses (ADR 0029). Server-side speech-to-text therefore needs a provider path the app does not have. The audio itself must never be lost to an AI outage or an unconfigured workspace.

## Decision

- **The audio is saved before anything else.** The upload checks the bytes' type and size, writes the binary under `voice-<sha256>` before the write transaction (ADR 0054), then inserts the `files` and `note_voice_memos` rows in one short transaction. It makes no AI call and answers 201 whether or not AI is configured. A failed transaction keeps the binary: its key is the content's hash, and another memo may already name it.
- **The transcript comes from the reader for now.** A transcript sent with the audio, or pasted or typed later, is stored on the memo (`done`); without one the memo is `skipped`. `pending`, `failed` and `transcription_job_id` are kept in the schema for a server-side transcription capability, which needs its own ADR naming its provider path, model slot and cost accounting (ADR 0033).
- **The brief is the existing refinement.** Refine with AI appends the transcript to the note (when it is not there already) and starts `notes.refine` in the same transaction. The brief and its action items are that refinement's proposal; nothing reaches the note until the reader inserts it, and an insert appends.
- **A recording can come first.** `POST /notes/voice` makes a new note from a recording (NOTES-B36): the audio is stored before the transaction exactly as an upload's is, and the note, its memo and, with a transcript, the start of `notes.refine` go in one transaction. Because the note is new there is no prose of the reader's to protect, so a transcript is its content. A refinement AI cannot take is skipped, never a reason to refuse the note.
- **A memo's audio is kept.** Removing a memo soft-deletes its row; the binary stays, as every stored binary does (ADR 0034).

## Consequences

Recording and uploading work in every install, AI or not, and an existing note never changes behind the reader's back; a note made from a recording starts with the transcript in it, and its refinement is still a proposal. Until a transcription capability exists, a memo recorded in the browser has no transcript until the reader supplies one; the review card says so and offers the field. Binaries of removed memos stay on disk and in backups.

## Alternatives considered

- Transcribe in the browser with the Web Speech API: rejected; in the major browsers it sends the audio to the browser vendor's servers, a disclosure the workspace never chose.
- Call a provider's speech-to-text endpoint directly: rejected for now; it is a second AI client outside `src/core/ai`, with its own credentials and costs.
- Write the transcript into the note when it arrives: rejected; the reader decides what enters the note (NOTES-B18).
