import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { migrateDatabase } from '@/core/db/migrate';
import { files } from '@/core/db/system-schema';
import { id } from '@/core/db/ids';
import { insertUser } from '@/core/db/auth-repo';
import {
  deleteWallpaperRows,
  insertWallpaper,
  selectWallpaperById,
  selectWallpapers,
} from '../repo';
// ADMIN-B47: the repo writes and removes a wallpaper's two rows together and reads them joined.
beforeAll(() => migrateDatabase());
let author = '';
beforeEach(async () => {
  await clearDatabase();
  author = id();
  await insertUser(db(), {
    id: author,
    name: 'Admin',
    email: 'admin@example.test',
    passwordHash: 'x',
    role: 'admin',
  });
});
afterAll(() => closeDatabase());
const file = () => {
  const fileId = id();
  return {
    id: fileId,
    storageKey: `wallpaper-${fileId}`,
    mime: 'image/webp',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
  };
};
const sample = (name: string) => ({
  id: id(),
  name,
  tone: 'dark',
  accent: null,
  createdBy: author,
  image: file(),
  thumbnail: file(),
});
it('ADMIN-B47 a wallpaper is written as its image and thumbnail file rows and a wallpaper row, read joined, newest first', async () => {
  const first = sample('First');
  const second = sample('Second');
  await insertWallpaper(db(), first);
  await insertWallpaper(db(), second);
  const rows = await selectWallpapers(db());
  expect(rows.map((row) => row.name)).toEqual(['Second', 'First']);
  expect(await selectWallpaperById(db(), first.id)).toMatchObject({
    storageKey: first.image.storageKey,
    thumbnailKey: first.thumbnail.storageKey,
    mime: 'image/webp',
    sizeBytes: 10,
    accent: null,
  });
  expect(await selectWallpaperById(db(), id())).toBeUndefined();
});
it('ADMIN-B47 deleting a wallpaper removes its rows and its two files and no other', async () => {
  const kept = sample('Kept');
  const gone = sample('Gone');
  await insertWallpaper(db(), kept);
  await insertWallpaper(db(), gone);
  const row = await selectWallpaperById(db(), gone.id);
  if (!row) throw new Error('missing');
  await deleteWallpaperRows(db(), row);
  expect((await selectWallpapers(db())).map((r) => r.id)).toEqual([kept.id]);
  expect((await db().select().from(files)).map((f) => f.id).sort()).toEqual(
    [kept.image.id, kept.thumbnail.id].sort(),
  );
});
