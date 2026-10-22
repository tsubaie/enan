import 'server-only';
import { eq } from 'drizzle-orm';
import { type Database } from './client';
import { mailSettings } from './system-schema';
export async function readMailSettings(database: Database) {
  const [row] = await database.select().from(mailSettings).where(eq(mailSettings.id, 1));
  return row;
}
export async function saveMailSettings(
  database: Database,
  value: Omit<typeof mailSettings.$inferInsert, 'id' | 'updatedAt'>,
) {
  const row = { ...value, updatedAt: new Date() };
  await database
    .insert(mailSettings)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: mailSettings.id, set: row });
}
export async function deleteMailSettings(database: Database) {
  await database.delete(mailSettings).where(eq(mailSettings.id, 1));
}
