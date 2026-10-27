import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/client';
import { id } from '@/core/db/ids';
import { files } from '@/core/db/system-schema';
import { noteVoiceMemos } from '../schema/db';
// NOTES-I08: a note's voice memos with their files, oldest first.
const memoColumns = {
  id: noteVoiceMemos.id,
  noteId: noteVoiceMemos.noteId,
  fileId: noteVoiceMemos.fileId,
  originalName: files.originalName,
  mime: files.mime,
  sizeBytes: files.sizeBytes,
  durationSeconds: noteVoiceMemos.durationSeconds,
  transcript: noteVoiceMemos.transcript,
  transcriptionStatus: noteVoiceMemos.transcriptionStatus,
  transcriptionJobId: noteVoiceMemos.transcriptionJobId,
  transcriptionError: noteVoiceMemos.transcriptionError,
  createdAt: noteVoiceMemos.createdAt,
  createdBy: noteVoiceMemos.createdBy,
};
export async function selectVoiceMemos(database: Database, noteId: string) {
  const rows = await database
    .select(memoColumns)
    .from(noteVoiceMemos)
    .innerJoin(files, eq(files.id, noteVoiceMemos.fileId))
    .where(and(eq(noteVoiceMemos.noteId, noteId), isNull(noteVoiceMemos.deletedAt)))
    .orderBy(noteVoiceMemos.createdAt, noteVoiceMemos.id);
  return rows.map((row) => ({ ...row, audioUrl: `/api/v1/notes/${noteId}/voice/${row.id}/audio` }));
}
export async function selectVoiceMemo(database: Database, noteId: string, memoId: string) {
  const [row] = await database
    .select({ ...memoColumns, storageKey: files.storageKey })
    .from(noteVoiceMemos)
    .innerJoin(files, eq(files.id, noteVoiceMemos.fileId))
    .where(
      and(
        eq(noteVoiceMemos.id, memoId),
        eq(noteVoiceMemos.noteId, noteId),
        isNull(noteVoiceMemos.deletedAt),
      ),
    );
  return row;
}
export async function countVoiceMemos(database: Database, noteId: string) {
  const [row] = await database
    .select({ count: sql<number>`count(*)` })
    .from(noteVoiceMemos)
    .where(and(eq(noteVoiceMemos.noteId, noteId), isNull(noteVoiceMemos.deletedAt)));
  return row?.count ?? 0;
}
// Content-addressed: the same recording is one `files` row however often it is uploaded.
export async function upsertAudioFile(
  database: Database,
  value: Omit<typeof files.$inferInsert, 'id'>,
) {
  const [existing] = await database
    .select({ id: files.id })
    .from(files)
    .where(eq(files.storageKey, value.storageKey));
  if (existing) {
    await database
      .update(files)
      .set({ availability: 'available', archivedAt: null })
      .where(eq(files.id, existing.id));
    return existing.id;
  }
  const fileId = id();
  await database.insert(files).values({ ...value, id: fileId });
  return fileId;
}
export async function insertVoiceMemo(
  database: Database,
  value: typeof noteVoiceMemos.$inferInsert,
) {
  await database.insert(noteVoiceMemos).values(value);
}
export async function updateVoiceMemo(
  database: Database,
  memoId: string,
  patch: Partial<typeof noteVoiceMemos.$inferInsert>,
) {
  await database
    .update(noteVoiceMemos)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(noteVoiceMemos.id, memoId));
}
