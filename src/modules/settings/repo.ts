import 'server-only';
import { count, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database } from '@/core/db/client';
import { files } from '@/core/db/system-schema';
import { wallpapers } from './schema/db';
// ADMIN-B47: uploaded wallpapers. Each one is a `wallpapers` row (its name, tone and accent) and
// two `files` rows (the image and the picker's thumbnail), written and removed together.
const thumbnails = alias(files, 'thumbnails');
const columns = {
  id: wallpapers.id,
  name: wallpapers.name,
  tone: wallpapers.tone,
  accent: wallpapers.accent,
  createdAt: wallpapers.createdAt,
  fileId: files.id,
  storageKey: files.storageKey,
  mime: files.mime,
  sizeBytes: files.sizeBytes,
  thumbnailFileId: thumbnails.id,
  thumbnailKey: thumbnails.storageKey,
  thumbnailMime: thumbnails.mime,
};
export type WallpaperRow = {
  id: string;
  name: string;
  tone: string;
  accent: string | null;
  createdAt: Date;
  fileId: string;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  thumbnailFileId: string | null;
  thumbnailKey: string | null;
  thumbnailMime: string | null;
};
const joined = (database: Database) =>
  database
    .select(columns)
    .from(wallpapers)
    .innerJoin(files, eq(files.id, wallpapers.fileId))
    .leftJoin(thumbnails, eq(thumbnails.id, wallpapers.thumbnailFileId));
export async function selectWallpapers(database: Database): Promise<WallpaperRow[]> {
  return joined(database).orderBy(desc(wallpapers.createdAt), desc(wallpapers.id));
}
export async function selectWallpaperById(
  database: Database,
  id: string,
): Promise<WallpaperRow | undefined> {
  const [row] = await joined(database).where(eq(wallpapers.id, id));
  return row;
}
export async function countWallpapers(database: Database) {
  const [row] = await database.select({ total: count() }).from(wallpapers);
  return row?.total ?? 0;
}
type StoredFile = {
  id: string;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
};
export async function insertWallpaper(
  database: Database,
  input: {
    id: string;
    name: string;
    tone: string;
    accent: string | null;
    createdBy: string;
    image: StoredFile;
    thumbnail: StoredFile;
  },
) {
  for (const file of [input.image, input.thumbnail])
    await database.insert(files).values({
      id: file.id,
      storageKey: file.storageKey,
      originalName: input.name,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      uploadedBy: input.createdBy,
    });
  await database.insert(wallpapers).values({
    id: input.id,
    fileId: input.image.id,
    thumbnailFileId: input.thumbnail.id,
    name: input.name,
    tone: input.tone,
    accent: input.accent,
    createdBy: input.createdBy,
  });
}
export async function deleteWallpaperRows(database: Database, row: WallpaperRow) {
  await database.delete(wallpapers).where(eq(wallpapers.id, row.id));
  await database.delete(files).where(eq(files.id, row.fileId));
  if (row.thumbnailFileId) await database.delete(files).where(eq(files.id, row.thumbnailFileId));
}
