import { db } from '@/core/db/client';
import { insertUser } from '@/core/db/auth-repo';
import { files } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { User } from '@/core/http/user-schema';
import { captures, captureSuggestions } from '../schema/db';
// Rows written straight to the tables: the capture services that create them arrive with
// recording, and these scenarios are about the shape and who may read it.
export async function user(name: string, role: 'admin' | 'member') {
  return User.parse(
    await insertUser(db(), {
      id: id(),
      name,
      email: `${name.toLowerCase().replace(/\W+/gu, '.')}@example.test`,
      passwordHash: 'unused-test-hash',
      role,
    }),
  );
}
export async function audioFile() {
  const sha256 = id().replaceAll('-', '');
  const [row] = await db()
    .insert(files)
    .values({
      id: id(),
      storageKey: `voice-${sha256}`,
      originalName: 'Recording.webm',
      mime: 'audio/webm',
      sizeBytes: 2048,
      sha256,
    })
    .returning();
  if (!row) throw new Error('file not inserted');
  return row;
}
export async function capture(recorder: User, fields: Partial<typeof captures.$inferInsert> = {}) {
  const file = await audioFile();
  const [row] = await db()
    .insert(captures)
    .values({
      id: id(),
      fileId: file.id,
      createdBy: recorder.id,
      updatedBy: recorder.id,
      ...fields,
    })
    .returning();
  if (!row) throw new Error('capture not inserted');
  return row;
}
export async function suggestion(
  captureId: string,
  fields: Partial<typeof captureSuggestions.$inferInsert> = {},
) {
  const [row] = await db()
    .insert(captureSuggestions)
    .values({ id: id(), captureId, kind: 'task', payload: { title: 'Follow up' }, ...fields })
    .returning();
  if (!row) throw new Error('suggestion not inserted');
  return row;
}
