# ADR 0073 — Voice captures tell their recorder when drafts are ready, in one grouped item

**Status:** accepted (2026-11-23). Supersedes one bullet of ADR 0071, "Nothing notifies and nothing refines before Approve", for its notification half and for two kinds only; the rest of ADR 0071 stands.

## Context

ADR 0071 kept every capture silent until Approve: the Review badge was the only way a recorder learned that drafts were ready, and a sheet after Stop followed the recording until it was ready. In use, a recorder stops and goes back to work. A blocking sheet after every recording is in the way, and a badge alone does not say that something changed while they were elsewhere, or that a recording could not be processed at all. The product asked for the sheet to go, for a short message after Stop, and for a quiet item in the bell when drafts are ready, grouped rather than one per recording.

## Decision

- **Two kinds, recorder only, no actor.** `captures.ready` and `captures.failed` are owned by the captures module. Each is addressed to the person who recorded the capture and to nobody else, administrators included; neither names an actor.
- **Ready is one grouped line per recorder.** Its subject is the recorder's own user id, so the unread-row upsert (NOTIF-I02) folds every recording that becomes ready into one line and moves it to the top; once read, the next ready recording opens a new line. Its number is counted when the bell is read (the reader's own live captures that are ready with at least one pending draft), never stored, so Approve, Discard, Delete and Restore keep it honest without writing to it. At zero it does not resolve and is not drawn.
- **Failed is one line per recording**, written when the job the capture waits on fails for good, or when the interpretation a transcription asked for is refused inside that job's publish. It resolves only while the reader may see the capture and it still reads as failed, and it opens the inbox on that recording.
- **Written behind the job fence.** Both are written in the job's own publish or fail transaction, only while the capture still waits on that job and is not deleted. A restore after the job ended, a retry, a typed transcript or any other request writes neither.
- **Nothing of the recording travels.** The payload is empty: no transcript, no title, no count.
- **The after-Stop sheet is removed.** After Stop the recorder closes and the reader stays where they were; toasts say what became of the recording (uploading, processing, saved but not transcribed, failed with the audio held for Retry or Discard, refused). Ready in the same session raises no toast: the bell and the badges carry it.
- Everything else in ADR 0071 holds: no notification on record, transcribe, interpret, edit or discard beyond these two kinds; Approve's side effects are unchanged; captures never enqueue `ai.notes.transcribe`; and `job.finished` is never written for a capture's jobs.

## Consequences

A recorder learns about ready drafts and failures without watching the recording. The bell gains a kind group for recordings. The notifications table is rebuilt once to widen its kind CHECK (migration `0022`); the previous release skips kinds it does not know, so it can still run on the database. No other member, and no administrator, can learn of someone else's recordings through the bell.

## Alternatives considered

- One notification per ready recording: rejected; a morning of recordings would flood the bell, which the product ruled out.
- Keep the sheet and add the bell: rejected; the sheet is the interruption the change removes.
- Notify administrators of failures: rejected; drafts are the recorder's until approved, and an administrator can already open any capture from the inbox.
