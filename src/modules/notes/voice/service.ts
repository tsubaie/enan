import 'server-only';
import { z } from 'zod';
import type { Context } from '@/core/auth/session';
import { db, withTransaction } from '@/core/db/client';
import { transactional } from '@/core/db/transaction';
import { id } from '@/core/db/ids';
import { writeAudit } from '@/core/db/audit-repo';
import { readStoredFile, writeStoredFile } from '@/core/files/storage';
import { checkVoiceAudio, voiceAudioLimits } from '@/core/files/voice-audio';
import { AppError } from '@/core/http/errors';
import { VoiceTranscribe, VoiceUpload } from '../schema/validation';
import { selectNote } from '../repo';
import { getNote, patchNote } from '../service';
import * as voiceRepo from './repo';
// NOTES-B29: the audio is checked and stored before the write lock (ADR 0054), then the file and
// memo rows go in one short transaction. No AI call is made, so the upload succeeds whether or
// not AI is configured: a memo without a transcript is `skipped`. A failed transaction keeps the
// binary, since its key is the content's hash and another memo may already name it.
export async function uploadVoiceMemo(
  ctx: Context,
  noteId: string,
  input: z.output<typeof VoiceUpload>,
) {
  if (input.file.size > voiceAudioLimits.maxBytes)
    throw new AppError('rule_violation', {
      reason: 'too_large',
      maxBytes: voiceAudioLimits.maxBytes,
    });
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const audio = checkVoiceAudio(bytes, input.file.name);
  await writeStoredFile(audio.storageKey, bytes);
  return withTransaction(ctx.db, async (database) => {
    const scoped = { ...ctx, db: database };
    await getNote(scoped, noteId);
    if ((await voiceRepo.countVoiceMemos(database, noteId)) >= voiceAudioLimits.maxPerNote)
      throw new AppError('rule_violation', {
        reason: 'limit_reached',
        max: voiceAudioLimits.maxPerNote,
      });
    const fileId = await voiceRepo.upsertAudioFile(database, {
      storageKey: audio.storageKey,
      originalName: audio.originalName,
      mime: audio.mime,
      sizeBytes: audio.sizeBytes,
      sha256: audio.sha256,
      uploadedBy: ctx.user.id,
    });
    const memoId = id();
    await voiceRepo.insertVoiceMemo(database, {
      id: memoId,
      noteId,
      fileId,
      durationSeconds: input.durationSeconds,
      transcript: input.transcript ?? null,
      transcriptionStatus: input.transcript ? 'done' : 'skipped',
      createdBy: ctx.user.id,
    });
    await writeAudit(database, ctx.user.id, 'create', 'note_voice_memo', memoId, {
      noteId,
      fileId,
      durationSeconds: input.durationSeconds,
    });
    return getNote(scoped, noteId);
  });
}
async function requireMemo(ctx: Context, noteId: string, memoId: string) {
  const note = await getNote(ctx, noteId);
  const memo = await voiceRepo.selectVoiceMemo(ctx.db, noteId, memoId);
  if (!memo) throw new AppError('not_found', { entityType: 'note_voice_memo' });
  return { note, memo };
}
// NOTES-B30: removing a memo soft-deletes its row; the binary stays (ADR 0034).
export const removeVoiceMemo = transactional(async function removeVoiceMemo(
  ctx: Context,
  noteId: string,
  memoId: string,
) {
  await requireMemo(ctx, noteId, memoId);
  const opId = id();
  await voiceRepo.updateVoiceMemo(ctx.db, memoId, { deletedAt: new Date(), deletedOpId: opId });
  await writeAudit(ctx.db, ctx.user.id, 'delete', 'note_voice_memo', memoId, { noteId }, opId);
  return getNote(ctx, noteId);
});
// NOTES-B31: a transcript given here is stored on the memo; the note's content changes only when
// `appendToNote` asks, and then the transcript goes after what is there, never in its place.
export const transcribeVoiceMemo = transactional(async function transcribeVoiceMemo(
  ctx: Context,
  noteId: string,
  memoId: string,
  input: z.output<typeof VoiceTranscribe>,
) {
  const { note, memo } = await requireMemo(ctx, noteId, memoId);
  if (input.transcript !== undefined) {
    await voiceRepo.updateVoiceMemo(ctx.db, memoId, {
      transcript: input.transcript,
      transcriptionStatus: 'done',
      transcriptionError: null,
    });
    await writeAudit(ctx.db, ctx.user.id, 'update', 'note_voice_memo', memoId, { noteId });
  }
  const transcript = input.transcript ?? memo.transcript;
  if ((input.appendToNote || input.refine) && !transcript)
    throw new AppError('rule_violation', { reason: 'no_transcript' });
  if (input.appendToNote && transcript) {
    const content = note.content.trim() ? `${note.content.trimEnd()}\n\n${transcript}` : transcript;
    if (content.length > 50000) throw new AppError('rule_violation', { rule: 'NOTES-I01' });
    await patchNote(ctx, noteId, { content, revision: note.revision });
  }
  return getNote(ctx, noteId);
});
// NOTES-B32: the audio of a live memo on a live note, for any signed-in member.
export async function voiceMemoAudio(noteId: string, memoId: string) {
  if (!z.uuid().safeParse(noteId).success || !z.uuid().safeParse(memoId).success) return null;
  const database = db();
  const note = await selectNote(database, noteId);
  if (!note || note.deletedAt) return null;
  const memo = await voiceRepo.selectVoiceMemo(database, noteId, memoId);
  if (!memo) return null;
  try {
    return {
      mime: memo.mime,
      name: memo.originalName,
      bytes: await readStoredFile(memo.storageKey),
    };
  } catch {
    return null;
  }
}
