import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { env } from '@/core/config/env';
import { databaseFor, openClient } from '../client';
import { databasePath, removeDatabaseDirectory } from '../test-database';
// A directory of its own beside the test database, so the files the rename touches are this test's.
const dir = join(dirname(databasePath(env().DATABASE_URL)), `former-name-${randomUUID()}`);
const former = join(dir, 'executiveos.db');
const current = join(dir, 'enan.db');
afterEach(() => removeDatabaseDirectory(dir));
async function write(path: string, value: string) {
  const client = openClient(`file:${path}`, 1);
  await client.primed;
  await databaseFor(client).run(sql`create table kept (value text)`);
  await databaseFor(client).run(sql`insert into kept values (${value})`);
  client.close();
}
async function read(path: string) {
  const client = openClient(`file:${path}`, 1);
  await client.primed;
  try {
    const rows = await databaseFor(client).all<{ value: string }>(sql`select value from kept`);
    return rows.map((row) => row.value);
  } finally {
    client.close();
  }
}
it('ADMIN-B50 opening enan.db takes over the executiveos.db left in the same directory', async () => {
  await write(former, 'from before the rename');
  expect(await read(current)).toEqual(['from before the rename']);
  // The former name now opens as a new, empty file.
  await expect(read(former)).rejects.toHaveProperty(
    'cause.message',
    expect.stringMatching(/no such table/u),
  );
});
it('ADMIN-B50 an existing enan.db is opened as it is and the former file is left alone', async () => {
  await write(current, 'current');
  await write(former, 'former');
  expect(await read(current)).toEqual(['current']);
  expect(await read(former)).toEqual(['former']);
});
