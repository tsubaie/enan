import 'server-only';
import { eq } from 'drizzle-orm';
import type { Database } from './client';
import { id } from './ids';
import { files } from './system-schema';
// Content-addressed: the same recording is one `files` row however often it is uploaded, by a
// voice memo or a capture alike.
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
