import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDatabase, db } from '@/core/db/client';
import { clearDatabase } from '@/core/db/reset';
import { constraintViolation } from '@/core/db/errors';
import { id } from '@/core/db/ids';
import { migrateDatabase } from '@/core/db/migrate';
// ADMIN-B47: the database keeps a wallpaper's tone to light or dark, one wallpaper per file, and a
// file from being removed while a wallpaper still names it.
beforeAll(() => migrateDatabase());
beforeEach(() => clearDatabase());
afterAll(() => closeDatabase());
const violation = <T>(statement: Promise<T>) =>
  statement.then(
    () => null,
    (error: Error) => constraintViolation(error),
  );
const file = async () => {
  const fileId = id();
  await db().run(
    sql`insert into files (id, storage_key, original_name, mime, size_bytes, sha256) values (${fileId}, ${`wallpaper-${fileId}`}, 'x', 'image/png', 1, 'x')`,
  );
  return fileId;
};
const wallpaper = (fileId: string, tone = 'dark') =>
  db().run(
    sql`insert into wallpapers (id, file_id, name, tone) values (${id()}, ${fileId}, 'x', ${tone})`,
  );
it('ADMIN-B47 a wallpaper is light or dark, one per file, and its file cannot go first', async () => {
  const fileId = await file();
  expect(await violation(wallpaper(fileId, 'grey'))).toMatchObject({
    kind: 'check',
    constraint: 'wallpapers_tone_check',
  });
  await expect(wallpaper(fileId)).resolves.toBeTruthy();
  expect(await violation(wallpaper(fileId, 'light'))).toMatchObject({ kind: 'unique' });
  // An ON DELETE RESTRICT refusal is reported by SQLite with the trigger code.
  expect(await violation(db().run(sql`delete from files where id = ${fileId}`))).not.toBeNull();
  expect(await db().all(sql`select id from files where id = ${fileId}`)).toHaveLength(1);
});
