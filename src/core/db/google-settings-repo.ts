import 'server-only';
import { eq } from 'drizzle-orm';
import { type Database } from './client';
import { googleSettings } from './system-schema';
export async function readGoogleSettings(database: Database) {
  const [row] = await database.select().from(googleSettings).where(eq(googleSettings.id, 1));
  return row;
}
export async function saveGoogleSettings(
  database: Database,
  value: { clientId: string; encryptedSecret: string },
) {
  const row = { ...value, updatedAt: new Date() };
  await database
    .insert(googleSettings)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({ target: googleSettings.id, set: row });
}
export async function deleteGoogleSettings(database: Database) {
  await database.delete(googleSettings).where(eq(googleSettings.id, 1));
}
