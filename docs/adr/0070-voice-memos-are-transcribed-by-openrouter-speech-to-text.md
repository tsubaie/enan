# ADR 0070 — Voice memos are transcribed by OpenRouter speech-to-text and write themselves into the note

**Status:** accepted (2026-11-16). Supersedes ADR 0065's "the transcript comes from the reader"; its other decisions stand. Extends ADR 0016, ADR 0033 and ADR 0054.

## Context

ADR 0065 left voice memos without a transcript unless the reader typed or pasted one, because the messages API that `src/core/ai` speaks (ADR 0016, ADR 0017) takes no audio, and it asked for a later ADR naming a provider path, a model slot and cost accounting. In use, that made a recording worth little: the point of speaking a memo is not having to write it.

OpenRouter now serves speech-to-text at `POST /api/v1/audio/transcriptions`. It takes the audio inline as base64 with its container format (`webm`, `m4a`, `mp3`, `wav` and `ogg` are all accepted, which are exactly the types NOTES-B29 stores), up to 25 MB (the NOTES-I08 limit), answers `{ text, usage: { cost, seconds } }`, and is reached with the same key and base URL as every other call. Its models (Whisper and others) are priced by the second and are not in the chat catalog.

## Decision

- **Transcription is a capability, `notes.transcribe`, with its own model slot.** `ai.model.transcription` defaults to `openai/whisper-large-v3` (99+ languages, Arabic among them). The AI page lists the provider's speech-to-text models (`/v1/models?output_modalities=transcription`) for it. The chat catalog cannot vouch for these models, so availability rests on the connection and the capability toggle, and a model the provider does not serve fails its job with that reason. This is the one exception to ADMIN-B25's "stored IDs alone never enable a capability".
- **The call goes through `src/core/ai` on the same SDK client.** `transcribeAudio` posts to the endpoint with the client's generic request method, without the `anthropic-version` header (as the catalog read does). No second client, credential or subprocess.
- **A memo without a transcript waits on a job keyed by the memo.** The upload still saves the audio first and makes no AI call in the request (ADR 0065, ADR 0054). In the same transaction it admits `ai.notes.transcribe` for the memo: `pending`, with the job's id. AI that cannot take it (off, unconfigured, over budget or rate) leaves the memo `skipped`, as before. Keying by memo lets each of a note's recordings be transcribed on its own.
- **Cost is reserved by the second and counted from the provider.** Admission reserves both attempts at a ceiling of 100 micro-dollars per second of audio, above every catalog rate seen (3–100). The invocation records the `usage.cost` the provider reports.
- **The transcript writes itself into the note, and so does its refinement.** When the job succeeds, its result is published in one transaction: the memo is `done` with the transcript; the transcript is appended to the note (a note that held nothing takes it as its content and, while it still has the name of its day, its first sentence as its title); and `notes.refine` is admitted with `autoApply`. That refinement, when it succeeds, is applied as an accepted rewrite would be, content only: tags and suggested tasks stay proposals in the brief. A note edited in the meantime refuses it (the revision fence) and the rewrite waits for review as any other. Each write is audited as the member who recorded the memo.
- **A memo whose job stopped reads as failed.** The memo's status is read with its job: `pending` with a failed or cancelled job (or none) is `failed`, with the job's reason. Transcribe with AI asks again; typing or pasting a transcript remains possible. Silence is a failure (`no_speech`), not an empty note.

## Consequences

Recording a memo is enough: with AI on, the note fills in by itself within seconds of the recording reaching the server, and a reader who edits meanwhile keeps their edit. Recordings still save with AI off or failing, and nothing is lost if transcription fails. The audio leaves the server for OpenRouter and its provider, as note text already does for refinement; workspaces that turn AI off, or this capability, send nothing. Providers stop a request after about a minute, which long memos (up to 15 minutes) may reach; such a memo fails with `timeout` and can be retried or typed.

## Alternatives considered

- Keep the reader's transcript (ADR 0065): rejected; it is the step people record a memo to avoid.
- Send audio to a chat model through the messages API: not possible; the API has no audio input.
- Show the refinement as a proposal to review (as manual refinement does): rejected for transcribed memos at the office's request; a recording should end as a finished note. The revision fence keeps it from overwriting the reader's own edits.
- Transcribe in the browser (Web Speech API): rejected in ADR 0065, for the same reason.
