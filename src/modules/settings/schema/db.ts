import 'server-only';
import { sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { files, users, time, now } from '@/core/db/system-schema';
// ADMIN-B47 (ADR 0037): an image an administrator uploaded to use as the workspace wallpaper. The
// binary is a `files` row like any stored file, so it lives under FILES_DIR and goes into every
// backup; this row gives it a name, and the tone and accent colour measured when it was uploaded. Deleting the
// wallpaper deletes both rows and the binary.
export const wallpapers = sqliteTable(
  'wallpapers',
  {
    id: text().primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    tone: text().notNull(),
    // ADR 0037: the colour picked from the image (#rrggbb), or null when it has none.
    accent: text(),
    // The picker's small copy; null for an image stored before thumbnails were made.
    thumbnailFileId: text('thumbnail_file_id').references(() => files.id, { onDelete: 'restrict' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: time('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('wallpapers_file_unique').on(t.fileId),
    uniqueIndex('wallpapers_thumbnail_file_unique').on(t.thumbnailFileId),
    index('wallpapers_created_by_idx').on(t.createdBy),
    index('wallpapers_created_at_idx').on(t.createdAt),
    check('wallpapers_tone_check', sql`${t.tone} in ('light','dark')`),
  ],
);
