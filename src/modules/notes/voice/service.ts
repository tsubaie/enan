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
import { getSetting } from '@/core/db/settings-repo';
import { dayAt } from '@/core/time/notes';
import { NoteCreate, VoiceCreate, VoiceTranscribe, VoiceUpload } from '../schema/validation';
import { selectNote } from '../repo';
import { createNote, getNote, patchNote } from '../service';
import { startNoteAi } from '../ai/service';
import * as voiceRepo from './repo';
type StoredAudio = Awaited<ReturnType<typeof storeVoiceAudio>>;
type MemoFields = { durationSeconds: number; transcript?: string | undefined };
// NOTES-B29: the audio is checked and stored before the write lock (ADR 0054), then the file and
// memo rows go in one short transaction. No AI call is made, so the upload succeeds whether or
// not AI is configured: a memo without a transcript is `skipped`. A failed transaction keeps the
// binary, since its key is the content's hash and another memo may already name it.
async function storeVoiceAudio(file: File) {
  if (file.size > voiceAudioLimits.maxBytes)
    throw new AppError('rule_violation', {
      reason: 'too_large',
      maxBytes: voiceAudioLimits.maxBytes,
    });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const audio = checkVoiceAudio(bytes, file.name);
  await writeStoredFile(audio.storageKey, bytes);
  return audio;
}
async function attachVoiceMemo(
  ctx: Context,
  noteId: string,
  audio: StoredAudio,
  input: MemoFields,
) {
  if ((await voiceRepo.countVoiceMemos(ctx.db, noteId)) >= voiceAudioLimits.maxPerNote)
    throw new AppError('rule_violation', {
      reason: 'limit_reached',
      max: voiceAudioLimits.maxPerNote,
    });
  const fileId = await voiceRepo.upsertAudioFile(ctx.db, {
    storageKey: audio.storageKey,
    originalName: audio.originalName,
    mime: audio.mime,
    sizeBytes: audio.sizeBytes,
    sha256: audio.sha256,
    uploadedBy: ctx.user.id,
  });
  const memoId = id();
  await voiceRepo.insertVoiceMemo(ctx.db, {
    id: memoId,
    noteId,
    fileId,
    durationSeconds: input.durationSeconds,
    transcript: input.transcript || null,
    transcriptionStatus: input.transcript ? 'done' : 'skipped',
    createdBy: ctx.user.id,
  });
  await writeAudit(ctx.db, ctx.user.id, 'create', 'note_voice_memo', memoId, {
    noteId,
    fileId,
    durationSeconds: input.durationSeconds,
  });
}
export async function uploadVoiceMemo(
  ctx: Context,
  noteId: string,
  input: z.output<typeof VoiceUpload>,
) {
  // An unknown or deleted note is refused before its audio reaches the disk.
  const note = await selectNote(ctx.db, noteId);
  if (!note || note.deletedAt) throw new AppError('not_found', { entityType: 'note' });
  const audio = await storeVoiceAudio(input.file);
  return withTransaction(ctx.db, async (database) => {
    const scoped = { ...ctx, db: database };
    await getNote(scoped, noteId);
    await attachVoiceMemo(scoped, noteId, audio, input);
    return getNote(scoped, noteId);
  });
}
// NOTES-B36: the note's title is the transcript's first sentence, without the marks of a heading
// or a list item, cut at a word to 120 characters; with no transcript it names the day.
export function voiceNoteTitle(transcript: string | undefined, today: string) {
  const line = (transcript ?? '')
    .split('\n')
    .map((text) => text.replace(/^[\s#*>-]+/u, '').trim())
    .find(Boolean);
  const sentence = line
    ?.split(/(?<=[.!?؟])\s/u)[0]
    ?.replace(/\.$/u, '')
    .trim();
  if (!sentence) return `Voice Memo · ${today}`;
  if (sentence.length <= 120) return sentence;
  const cut = sentence.slice(0, 119);
  const space = cut.lastIndexOf(' ');
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
// NOTES-B36: record first, and the note follows. The audio is stored before the transaction as
// an upload's is; the note, its memo and, with a transcript, the start of its refinement go in
// together. A refinement AI cannot take (off, unconfigured, over budget or rate) is skipped, and
// the note and its recording are created all the same.
export async function createNoteFromVoice(ctx: Context, input: z.output<typeof VoiceCreate>) {
  const audio = await storeVoiceAudio(input.file);
  const transcript = input.transcript || undefined;
  return withTransaction(ctx.db, async (database) => {
    const scoped = { ...ctx, db: database };
    const today = dayAt(await getSetting(database, 'workspace.timezone'));
    const note = await createNote(
      scoped,
      NoteCreate.parse({
        title: voiceNoteTitle(transcript, today),
        content: transcript ?? '',
        committeeId: input.committeeId ?? null,
        type: input.type ?? null,
      }),
    );
    await attachVoiceMemo(scoped, note.id, audio, { ...input, transcript });
    if (transcript)
      await startNoteAi(scoped, note.id, note.revision, 'notes.refine').catch((error: unknown) => {
        if (!(error instanceof AppError && error.code === 'ai_unavailable')) throw error;
      });
    return getNote(scoped, note.id);
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
