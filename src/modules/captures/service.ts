import 'server-only';
import { z } from 'zod';
import type { Context } from '@/core/auth/session';
import { db, withTransaction } from '@/core/db/client';
import { transactional } from '@/core/db/transaction';
import { id } from '@/core/db/ids';
import { writeAudit } from '@/core/db/audit-repo';
import { upsertAudioFile } from '@/core/db/files-repo';
import { getSetting } from '@/core/db/settings-repo';
import { admitAi, contentHash } from '@/core/ai/admission';
import { readStoredFile } from '@/core/files/storage';
import { storeVoiceAudio } from '@/core/files/voice-audio';
import { AppError } from '@/core/http/errors';
import { dayAt } from '@/core/time/notes';
import { committeeChoices, requireCommittee } from '@/modules/committees';
import { noteTypes } from '@/modules/notes';
import { assignablePeople } from '@/modules/people';
import { assertCaptureAccess } from './access';
import * as repo from './repo';
import { InterpretInput } from './ai/interpret';
import {
  CaptureCreate,
  CaptureGroup,
  CaptureListQuery,
  CaptureTranscript,
  Suggestion,
} from './schema/validation';
/**
 * Voice captures: a recording reviewed before anything goes live (ADR 0071).
 * Invariants protected here:
 * - CAPTURES-B01 the audio is stored first, then the capture row; no note or task is written.
 * - CAPTURES-B02 a capture is read and changed only by its recorder or an administrator; every
 *   other reader, like a missing or deleted id, gets `not_found` (`assertCaptureAccess`,
 *   `visibleCaptures`).
 * - CAPTURES-B05 transcription runs as `ai.captures.transcribe`, never `ai.notes.transcribe`.
 * - CAPTURES-I01 captures never touch `note_voice_memos` or notes.
 */
type Stored = NonNullable<Awaited<ReturnType<typeof repo.selectStoredCapture>>>;
const audioUrl = (captureId: string) => `/api/v1/captures/${captureId}/audio`;
const working = ['transcribing', 'interpreting'];
async function group(
  ctx: Context,
  rows: NonNullable<Awaited<ReturnType<typeof repo.selectCapture>>>[],
) {
  const suggestions = await repo.selectSuggestions(
    ctx.db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    CaptureGroup.parse({
      ...row,
      audioUrl: audioUrl(row.id),
      suggestions: suggestions
        .filter((suggestion) => suggestion.captureId === row.id)
        .map((suggestion) => Suggestion.parse(suggestion)),
    }),
  );
}
async function visibleCapture(ctx: Context, captureId: string) {
  return assertCaptureAccess(ctx.user, await repo.selectCapture(ctx.db, captureId));
}
export async function getCapture(ctx: Context, captureId: string) {
  const [detail] = await group(ctx, [await visibleCapture(ctx, captureId)]);
  if (!detail) throw new AppError('not_found', { entityType: 'capture' });
  return detail;
}
export async function pendingCaptureCount(ctx: Context) {
  return { pending: await repo.countPendingCaptures(ctx.db, ctx.user) };
}
const Cursor = z.object({ at: z.number().int(), id: z.uuid() });
// CAPTURES-B02: the reader's captures, newest first, each with its drafts.
export async function listCaptures(ctx: Context, query: z.output<typeof CaptureListQuery>) {
  let after: { createdAt: Date; id: string } | null = null;
  if (query.cursor) {
    const parsed = Cursor.safeParse(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString() || 'null'),
    );
    if (!parsed.success) throw new AppError('validation_failed', { field: 'cursor' });
    after = { createdAt: new Date(parsed.data.at), id: parsed.data.id };
  }
  const rows = await repo.selectCaptures(ctx.db, ctx.user, query.limit + 1, after, query.scope);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    data: await group(ctx, page),
    meta: {
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ at: last.createdAt.getTime(), id: last.id })).toString(
              'base64url',
            )
          : null,
    },
  };
}
// ADR 0070's admission, budget and model slot for transcription, on the capture's own job kind.
async function startTranscription(ctx: Context, capture: Stored) {
  const job = await admitAi(
    ctx,
    'notes.transcribe',
    capture.id,
    capture.revision,
    { captureId: capture.id },
    {
      audioSeconds: capture.durationSeconds,
      queue: { kind: 'ai.captures.transcribe', dedupKey: `captures.transcribe:${capture.id}` },
    },
  );
  await repo.updateCapture(ctx.db, capture.id, {
    status: 'transcribing',
    transcribeJobId: job.id,
    errorCode: null,
    errorDetail: null,
  });
}
// §4.3: the transcript and a small catalogue go to the interpreter as data. A new transcript is a
// new job (the dedup key carries its hash).
async function startInterpretation(ctx: Context, capture: Stored) {
  const transcript = capture.transcript;
  if (!transcript) throw new AppError('rule_violation', { reason: 'no_transcript' });
  const committees = await committeeChoices(ctx);
  const people = await assignablePeople(ctx);
  const types = await noteTypes(ctx);
  const transcriptHash = contentHash(transcript);
  const input = InterpretInput.parse({
    captureId: capture.id,
    transcriptHash,
    transcript,
    today: dayAt(await getSetting(ctx.db, 'workspace.timezone')),
    contextCommitteeId: capture.contextCommitteeId,
    contextNoteType: capture.contextNoteType,
    committees: committees.data
      .filter((committee) => !committee.deleted && committee.status === 'active')
      .map(({ id: committeeId, name }) => ({ id: committeeId, name })),
    people: people.map(({ id: personId, name }) => ({ id: personId, name })),
    noteTypes: types.filter((type) => type.enabled).map((type) => type.id),
  });
  const job = await admitAi(ctx, 'captures.interpret', capture.id, capture.revision, input, {
    queue: {
      kind: 'ai.captures.interpret',
      dedupKey: `captures.interpret:${capture.id}:${transcriptHash}`,
    },
  });
  await repo.updateCapture(ctx.db, capture.id, {
    status: 'interpreting',
    interpretJobId: job.id,
    errorCode: null,
    errorDetail: null,
  });
}
// A transcript that cannot be interpreted now leaves the capture failed with the reason, so the
// recorder can retry or delete it; the transcript and the audio stay.
export const interpretOrHold = transactional(async function interpretOrHold(
  ctx: Context,
  captureId: string,
  refused: readonly string[] = ['ai_unavailable'],
) {
  const capture = await repo.selectStoredCapture(ctx.db, captureId);
  if (!capture || capture.deletedAt) return;
  await startInterpretation(ctx, capture).catch(async (error: unknown) => {
    if (!(error instanceof AppError && refused.includes(error.code))) throw error;
    await repo.updateCapture(ctx.db, capture.id, { status: 'failed', errorCode: error.code });
  });
});
// CAPTURES-B01: the audio is stored before the transaction, then the file and capture rows go in
// one short transaction with the start of transcription (or, with a typed transcript, of
// interpretation). AI that cannot take it leaves the capture stored and `needs_transcript`.
export async function createCapture(ctx: Context, input: z.output<typeof CaptureCreate>) {
  const committeeId = input.committeeId ?? null;
  await requireCommittee(ctx, committeeId);
  const audio = await storeVoiceAudio(input.file);
  const transcript = input.transcript || null;
  // F1: the declared length is the client's word; the reservation and the row take the longer.
  const durationSeconds = Math.max(input.durationSeconds, audio.durationSeconds);
  return withTransaction(ctx.db, async (database) => {
    const scoped = { ...ctx, db: database };
    const fileId = await upsertAudioFile(database, {
      storageKey: audio.storageKey,
      originalName: audio.originalName,
      mime: audio.mime,
      sizeBytes: audio.sizeBytes,
      sha256: audio.sha256,
      uploadedBy: ctx.user.id,
    });
    const captureId = id();
    await repo.insertCapture(database, {
      id: captureId,
      fileId,
      durationSeconds,
      transcript,
      status: 'needs_transcript',
      contextCommitteeId: committeeId,
      contextNoteType: input.type ?? null,
      createdBy: ctx.user.id,
      updatedBy: ctx.user.id,
    });
    await writeAudit(database, ctx.user.id, 'create', 'capture', captureId, {
      fileId,
      durationSeconds,
    });
    const stored = await repo.selectStoredCapture(database, captureId);
    if (!stored) throw new AppError('internal');
    if (transcript) await interpretOrHold(scoped, captureId);
    else
      await startTranscription(scoped, stored).catch((error: unknown) => {
        if (!(error instanceof AppError && error.code === 'ai_unavailable')) throw error;
      });
    return getCapture(scoped, captureId);
  });
}
async function idleCapture(ctx: Context, captureId: string) {
  const capture = await visibleCapture(ctx, captureId);
  if (working.includes(capture.status)) throw new AppError('conflict', { reason: 'state' });
  const stored = await repo.selectStoredCapture(ctx.db, captureId);
  if (!stored) throw new AppError('not_found', { entityType: 'capture' });
  return { capture, stored };
}
// S17 «كتابة النص»: a typed transcript replaces whatever the capture held and is interpreted anew.
export const typeTranscript = transactional(async function typeTranscript(
  ctx: Context,
  captureId: string,
  input: z.output<typeof CaptureTranscript>,
) {
  const { stored } = await idleCapture(ctx, captureId);
  await repo.updateCapture(ctx.db, captureId, {
    transcript: input.transcript,
    revision: stored.revision + 1,
    updatedBy: ctx.user.id,
  });
  await writeAudit(ctx.db, ctx.user.id, 'update', 'capture', captureId, { transcript: true });
  await interpretOrHold(ctx, captureId);
  return getCapture(ctx, captureId);
});
// S17 «إعادة المحاولة»: transcription again, for a capture with no usable transcript yet.
export const retryTranscription = transactional(async function retryTranscription(
  ctx: Context,
  captureId: string,
) {
  const { capture, stored } = await idleCapture(ctx, captureId);
  if (capture.status === 'ready') throw new AppError('conflict', { reason: 'state' });
  await startTranscription(ctx, stored);
  return getCapture(ctx, captureId);
});
export const retryInterpretation = transactional(async function retryInterpretation(
  ctx: Context,
  captureId: string,
) {
  const { stored } = await idleCapture(ctx, captureId);
  await startInterpretation(ctx, stored);
  return getCapture(ctx, captureId);
});
// S17 «حذف التسجيل»: the capture and its drafts are soft-deleted; the binary stays (ADR 0034).
// A job still running for it publishes nothing (`jobs.ts`).
export const removeCapture = transactional(async function removeCapture(
  ctx: Context,
  captureId: string,
) {
  await visibleCapture(ctx, captureId);
  const opId = id();
  await repo.softDeleteCapture(ctx.db, captureId, ctx.user.id, opId);
  await writeAudit(ctx.db, ctx.user.id, 'delete', 'capture', captureId, {}, opId);
  return { opId };
});
// CAPTURES-B02: a draft's audio, only for whoever may see the draft. Never a public URL.
export async function captureAudio(user: Context['user'], captureId: string) {
  if (!z.uuid().safeParse(captureId).success) return null;
  const row = await repo.selectCaptureAudio(db(), captureId);
  if (!row) return null;
  try {
    assertCaptureAccess(user, row);
    return { mime: row.mime, name: row.name, bytes: await readStoredFile(row.storageKey) };
  } catch {
    return null;
  }
}
