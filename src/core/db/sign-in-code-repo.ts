import 'server-only';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { type Database } from './client';
import { signInCodes } from './system-schema';
// ADMIN-B63: how many codes were asked for by this email and from this address in the window,
// counted apart as login failures are (ADMIN-B20). A null address counts nothing.
export async function codeRequests(database: Database, email: string, address: string | null) {
  const [row] = await database
    .select({
      byEmail: sql<number>`count(*) filter (where ${signInCodes.email} = ${email})`.mapWith(Number),
      byAddress: sql<number>`count(*) filter (where ${signInCodes.ip} = ${address})`.mapWith(
        Number,
      ),
    })
    .from(signInCodes)
    .where(
      and(
        gt(signInCodes.createdAt, new Date(Date.now() - 900000)),
        or(
          eq(signInCodes.email, email),
          address === null ? undefined : eq(signInCodes.ip, address),
        ),
      ),
    );
  return { byEmail: row?.byEmail ?? 0, byAddress: row?.byAddress ?? 0 };
}
// A new code replaces every earlier one for the address: only the latest can be used.
export async function retireCodes(database: Database, email: string) {
  await database
    .update(signInCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(signInCodes.email, email), isNull(signInCodes.usedAt)));
}
export async function insertCode(database: Database, row: typeof signInCodes.$inferInsert) {
  await database.insert(signInCodes).values(row);
}
export async function latestCode(database: Database, email: string, maxAttempts: number) {
  const [row] = await database
    .select()
    .from(signInCodes)
    .where(
      and(
        eq(signInCodes.email, email),
        isNull(signInCodes.usedAt),
        gt(signInCodes.expiresAt, new Date()),
        lt(signInCodes.attempts, maxAttempts),
      ),
    )
    .orderBy(desc(signInCodes.createdAt))
    .limit(1);
  return row;
}
export async function spendCode(database: Database, codeId: string) {
  await database.update(signInCodes).set({ usedAt: new Date() }).where(eq(signInCodes.id, codeId));
}
export async function missCode(database: Database, codeId: string) {
  await database
    .update(signInCodes)
    .set({ attempts: sql`${signInCodes.attempts} + 1` })
    .where(eq(signInCodes.id, codeId));
}
